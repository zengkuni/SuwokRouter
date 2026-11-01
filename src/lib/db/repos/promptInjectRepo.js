// Prompt Injection storage: one injection per target — global, per API key,
// per model (combo/alias name or "provider/model") — each either a single
// system prompt (prepend/append) or a scripted chat (fake history turns).
//
// Stacking order per request: global → key → model (+key), max 3 entries.
// All reads are fail-open: a broken store or entry never fails a request.
//
// Templates are a library of saved prompts (name + prompt body). They never
// run on their own; creating an injection "from template" copies the body
// into that injection (templateName records the origin for display).
//
// Ported from 9router-pro (giienew) src/lib/db/repos/promptInjectRepo.js,
// minus the upstream variants concept (SuwokRouter combos already provide
// named models).

import { makeKv } from "../helpers/kvStore.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

export const MAX_TURNS = 50;
export const MAX_TEMPLATES = 50;
const MAX_NAME_LEN = 120;
const MAX_TEMPLATE_NAME_LEN = 80;

const GLOBAL_KEY = "global";
const BY_KEY_KEY = "byKey";
const BY_MODEL_KEY = "byModel";
const BY_KEY_MODEL_KEY = "byKeyModel";
const TEMPLATES_KEY = "templates";

const kv = makeKv("promptInjections");

// --------------------------------------------------------------- cleaning

export function cleanTurns(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const role = t.role === "assistant" ? "assistant" : t.role === "user" ? "user" : null;
    const content = typeof t.content === "string" ? t.content : "";
    if (role && content.trim()) out.push({ role, content });
    if (out.length >= MAX_TURNS) break;
  }
  return out;
}

export function cleanEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = {
    position: raw.position === "prepend" ? "prepend" : "append",
    enabled: raw.enabled !== false,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    // Custom display name for this entry; never a match key.
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : typeof raw.label === "string" && raw.label.trim()
          ? raw.label.trim().slice(0, 80)
          : null,
    // Name of the template this entry was created from (display only).
    templateName:
      typeof raw.templateName === "string" && raw.templateName.trim()
        ? raw.templateName.trim().slice(0, MAX_TEMPLATE_NAME_LEN)
        : null,
  };
  if (raw.mode === "chat") {
    const turns = cleanTurns(raw.turns);
    if (!turns.length) return null;
    return { mode: "chat", content: "", turns, ...base };
  }
  if (raw.mode !== "single") return null;
  const content = typeof raw.content === "string" ? raw.content : "";
  if (!content.trim()) return null;
  return { mode: "single", content, turns: [], ...base };
}

function cleanMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, entry] of Object.entries(raw)) {
    const clean = cleanEntry(entry);
    if (name && clean) out[name] = clean;
  }
  return out;
}

function cleanKeyModelMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [keyId, inner] of Object.entries(raw)) {
    if (!keyId) continue;
    out[keyId] = cleanMap(inner);
  }
  return out;
}

function stamp(input = {}) {
  return cleanEntry({
    mode: input.mode,
    content: input.content,
    turns: input.turns,
    position: input.position,
    enabled: input.enabled,
    name: input.name || input.label,
    templateName: input.templateName,
    updatedAt: new Date().toISOString(),
  });
}

function cleanMapName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > MAX_NAME_LEN) return "";
  return name;
}

// --------------------------------------------------------------- templates
// A template is a named prompt body — same shape as an injection entry minus
// the target. It never runs on its own; injections copy its body on save.

export function cleanTemplate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, MAX_TEMPLATE_NAME_LEN)
      : "";
  if (!name) return null;
  const body = cleanEntry({
    mode: raw.mode,
    content: raw.content,
    turns: raw.turns,
    position: raw.position,
  });
  if (!body) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim().slice(0, 64)
      : crypto.randomUUID();
  return { id, name, mode: body.mode, content: body.content, turns: body.turns, position: body.position };
}

export function cleanTemplates(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const clean = cleanTemplate(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

export async function listTemplates() {
  return cleanTemplates(await kv.get(TEMPLATES_KEY, []));
}

export async function setTemplate(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const current = cleanTemplates(await kv.get(TEMPLATES_KEY, []));
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const existing = id ? current.find((t) => t.id === id) : null;
  if (!existing && current.length >= MAX_TEMPLATES) return null;
  const template = cleanTemplate({ ...raw, id: existing ? existing.id : id || undefined });
  if (!template) return null;
  const next = [...current.filter((t) => t.id !== template.id), template];
  await kv.set(TEMPLATES_KEY, next);
  await bumpConfigCacheVersion().catch(() => {});
  return template;
}

export async function deleteTemplate(id) {
  const tid = typeof id === "string" ? id.trim() : "";
  if (!tid) return false;
  const current = cleanTemplates(await kv.get(TEMPLATES_KEY, []));
  const next = current.filter((t) => t.id !== tid);
  if (next.length === current.length) return false;
  await kv.set(TEMPLATES_KEY, next);
  await bumpConfigCacheVersion().catch(() => {});
  return true;
}

// --------------------------------------------------------------- selection
// Pure, exported for tests. Stacked least → most specific:
// global → key → model(+key). Per model scope the first matching name wins:
// the resolved "provider/model" first, then the name the client asked for
// (combo name, alias, or bare model).

export function selectPromptInjections(state = {}, ctx = {}) {
  const out = [];
  const push = (name, e) => {
    if (!e || !e.enabled) return;
    if (e.mode === "chat") out.push({ name, mode: "chat", turns: e.turns, position: e.position });
    else out.push({ name, mode: "single", text: e.content, position: e.position });
  };

  push("global", cleanEntry(state.global));

  const apiKeyId = typeof ctx.apiKeyId === "string" ? ctx.apiKeyId : "";
  if (apiKeyId) {
    push("key", cleanMap(state.byKey)[apiKeyId]);
  }

  const names = [];
  for (const n of [ctx.resolvedModel, ctx.requestedModel]) {
    if (typeof n === "string" && n && !names.includes(n)) names.push(n);
  }
  const firstHit = (map) => {
    for (const name of names) {
      const entry = map[name];
      if (entry && entry.enabled) return { name, entry };
    }
    return null;
  };

  const modelHit = firstHit(cleanMap(state.byModel));
  if (modelHit) push(modelHit.name, modelHit.entry);

  if (apiKeyId) {
    const scoped = cleanKeyModelMap(state.byKeyModel)[apiKeyId];
    if (scoped) {
      const hit = firstHit(scoped);
      if (hit) push(hit.name, hit.entry);
    }
  }
  return out;
}

// --------------------------------------------------------------- state read
// One snapshot for the whole hot path, TTL-cached and cross-process
// invalidated by every write below.

const stateCache = getConfigCache("promptInjections", { ttlMs: 3000 });

export async function getPromptInjectionState() {
  return await stateCache.get("all", async () => {
    const [global, byKey, byModel, byKeyModel, templates] = await Promise.all([
      kv.get(GLOBAL_KEY, null),
      kv.get(BY_KEY_KEY, null),
      kv.get(BY_MODEL_KEY, null),
      kv.get(BY_KEY_MODEL_KEY, null),
      kv.get(TEMPLATES_KEY, []),
    ]);
    return {
      global: cleanEntry(global),
      byKey: cleanMap(byKey),
      byModel: cleanMap(byModel),
      byKeyModel: cleanKeyModelMap(byKeyModel),
      templates: cleanTemplates(templates),
    };
  });
}

// Resolve the injections for one request (global → key → model(+key)).
// Fail-open: storage problems degrade to "no injections".
export async function resolvePromptInjections(ctx = {}) {
  try {
    const state = await getPromptInjectionState();
    return selectPromptInjections(state, ctx);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- writes

async function writeMap(key, mutate, cleaner = cleanMap) {
  const raw = await kv.get(key, null);
  const map = cleaner(raw);
  const result = mutate(map);
  await kv.set(key, map);
  await bumpConfigCacheVersion().catch(() => {});
  return result;
}

export async function setInjectGlobal(input = {}) {
  const entry = stamp(input);
  if (!entry) await kv.remove(GLOBAL_KEY);
  else await kv.set(GLOBAL_KEY, entry);
  await bumpConfigCacheVersion().catch(() => {});
  return entry;
}

export async function deleteInjectGlobal() {
  await kv.remove(GLOBAL_KEY);
  await bumpConfigCacheVersion().catch(() => {});
}

export async function setInjectKeyPrompt(keyId, input = {}) {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  if (!id) return null;
  return await writeMap(BY_KEY_KEY, (map) => {
    const entry = stamp(input);
    if (!entry) delete map[id];
    else map[id] = entry;
    return entry;
  });
}

export async function deleteInjectKeyPrompt(keyId) {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  if (!id) return false;
  return await writeMap(BY_KEY_KEY, (map) => {
    if (!(id in map)) return false;
    delete map[id];
    return true;
  });
}

export async function setInjectModelPrompt(model, input = {}) {
  const name = cleanMapName(model);
  if (!name) return null;
  return await writeMap(BY_MODEL_KEY, (map) => {
    const entry = stamp(input);
    if (!entry) delete map[name];
    else map[name] = entry;
    return entry;
  });
}

export async function deleteInjectModelPrompt(model) {
  const name = cleanMapName(model);
  if (!name) return false;
  return await writeMap(BY_MODEL_KEY, (map) => {
    if (!(name in map)) return false;
    delete map[name];
    return true;
  });
}

export async function setInjectKeyModelPrompt(keyId, model, input = {}) {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  const name = cleanMapName(model);
  if (!id || !name) return null;
  return await writeMap(BY_KEY_MODEL_KEY, (map) => {
    if (!map[id] || typeof map[id] !== "object") map[id] = {};
    const entry = stamp(input);
    if (!entry) delete map[id][name];
    else map[id][name] = entry;
    return entry;
  }, cleanKeyModelMap);
}

export async function deleteInjectKeyModelPrompt(keyId, model) {
  const id = typeof keyId === "string" ? keyId.trim() : "";
  const name = cleanMapName(model);
  if (!id || !name) return false;
  return await writeMap(BY_KEY_MODEL_KEY, (map) => {
    if (!map[id] || !(name in map[id])) return false;
    delete map[id][name];
    if (!Object.keys(map[id]).length) delete map[id];
    return true;
  }, cleanKeyModelMap);
}
