import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Download, MessageSquarePlus, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { api, getErrorMessage } from "@/lib/api";
import { listApiKeys } from "@/lib/api-keys-api";
import {
  MAX_TURNS,
  deleteInjection,
  deleteTemplate,
  getInjectionState,
  previewInjections,
  saveInjection,
  saveTemplate,
  type ChatTurn,
  type InjectionEntry,
  type InjectionInput,
  type InjectionScope,
  type InjectionTemplate,
  type InjectMode,
  type InjectPosition,
  type PreviewInjection,
} from "@/lib/prompt-injection-api";
import { probeEnabled } from "@/lib/live-mode";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function emptyEntry(): InjectionInput {
  return { mode: "single", content: "", turns: [], position: "append", enabled: true };
}

function entryToInput(entry: InjectionEntry): InjectionInput {
  return {
    mode: entry.mode,
    content: entry.content,
    turns: entry.turns ?? [],
    position: entry.position,
    enabled: entry.enabled,
    name: entry.name,
    templateName: entry.templateName,
  };
}

function entrySummary(entry: InjectionEntry) {
  if (entry.mode === "chat") {
    return `${entry.turns.length} turn${entry.turns.length === 1 ? "" : "s"} scripted`;
  }
  const text = entry.content || "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "(empty)";
}

// Rough token estimate for cards — same heuristic as 9router-pro.
function entryText(entry: { mode: string; content?: string; turns?: ChatTurn[] }) {
  if (entry.mode === "chat") return (entry.turns ?? []).map((t) => t.content).join("\n");
  return entry.content ?? "";
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

type EditorState = {
  kind: "injection" | "template";
  scope?: InjectionScope;
  title: string;
  keyId?: string;
  model?: string;
  entry: InjectionInput;
  existing?: InjectionEntry;
  templateId?: string;
} | null;

function InjectionEditor({
  editor,
  saving,
  templates,
  onSave,
  onClose,
  onDelete,
}: {
  editor: EditorState;
  saving: boolean;
  templates: InjectionTemplate[];
  onSave: (input: InjectionInput) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const isTemplate = editor?.kind === "template";
  const [draft, setDraft] = useState<InjectionInput>(editor?.entry ?? emptyEntry());
  const [draftKey, setDraftKey] = useState<EditorState>(editor);
  const [source, setSource] = useState<"new" | "template">("new");
  const [tplId, setTplId] = useState("");

  // Reset the form whenever a different entry is opened.
  if (editor !== draftKey) {
    setDraftKey(editor);
    setDraft(editor?.entry ?? emptyEntry());
    setSource("new");
    setTplId("");
  }

  // Picking a template copies its body into the draft — the template itself
  // stays unchanged; templateName records the origin for display.
  useEffect(() => {
    if (source !== "template" || !tplId) return;
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setDraft({
      mode: tpl.mode,
      content: tpl.content,
      turns: tpl.turns ?? [],
      position: tpl.position,
      enabled: true,
      templateName: tpl.name,
    });
  }, [source, tplId, templates]);

  const turns = draft.turns ?? [];
  const canSave =
    (isTemplate ? !!draft.name?.trim() : true) &&
    (draft.mode === "single"
      ? !!draft.content?.trim()
      : turns.some((t) => t.content.trim()));

  function setTurn(i: number, patch: Partial<{ role: "user" | "assistant"; content: string }>) {
    setDraft((d) => ({
      ...d,
      turns: (d.turns ?? []).map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    }));
  }

  const canPickTemplate =
    !isTemplate && !editor?.existing && templates.length > 0;

  return (
    <Dialog open={!!editor} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base font-semibold tracking-tight">
            {editor?.title ?? "Prompt Injection"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isTemplate
              ? "Saved prompt in your library. Templates never run on their own — creating an injection from one copies its content."
              : "Injected into every matching request, after translation. Global → key → model, in that order."}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel
          scroll={false}
          className="flex min-h-0 flex-1 flex-col space-y-4"
        >
          {canPickTemplate && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Source
                </span>
                <Segmented<"new" | "template">
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: "new", label: "New" },
                    { value: "template", label: "From template" },
                  ]}
                />
              </div>
              {source === "template" && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                    Template
                  </span>
                  <select
                    className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                    value={tplId}
                    onChange={(e) => setTplId(e.target.value)}
                  >
                    <option value="">Select template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                Mode
              </span>
              <Segmented<InjectMode>
                value={draft.mode}
                onChange={(mode) =>
                  setDraft((d) => ({
                    ...d,
                    mode,
                    content: mode === "chat" ? d.content : (d.content || ""),
                    turns: mode === "chat" ? d.turns : [],
                  }))
                }
                options={[
                  { value: "single", label: "Single prompt" },
                  { value: "chat", label: "Scripted chat" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                Position
              </span>
              <Segmented<InjectPosition>
                value={draft.position ?? "append"}
                onChange={(position) => setDraft((d) => ({ ...d, position }))}
                options={[
                  { value: "prepend", label: "Prepend" },
                  { value: "append", label: "Append" },
                ]}
              />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              {isTemplate ? "Template name" : "Label"}
            </span>
            <Input
              placeholder={isTemplate ? "Template name" : "Label (optional)"}
              value={draft.name ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="h-10 items-center rounded-xl border-0 bg-white/[0.03] text-sm ring-1 ring-inset ring-white/[0.06] has-focus-visible:border-transparent has-focus-visible:ring-1 has-focus-visible:ring-primary/40"
            />
          </div>

          {draft.mode === "single" ? (
            <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                System prompt
              </span>
              <textarea
                className="min-h-[160px] w-full flex-1 resize-none rounded-xl border-0 bg-white/[0.03] px-3 py-2 text-sm ring-1 ring-inset ring-white/[0.06] outline-none focus:ring-1 focus:ring-primary/40"
                placeholder="System prompt to inject…"
                value={draft.content ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Scripted turns
                </span>
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {turns.length}
                </span>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={turns.length >= MAX_TURNS}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      turns: [...(d.turns ?? []), { role: "user", content: "" }],
                    }))
                  }
                >
                  <Plus className="mr-1 h-4 w-4" /> Add turn
                </Button>
              </div>
              <div className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1">
                {turns.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Segmented<"user" | "assistant">
                      size="sm"
                      className="w-[176px] flex-none"
                      value={t.role}
                      onChange={(role) => setTurn(i, { role })}
                      options={[
                        { value: "user", label: "User" },
                        { value: "assistant", label: "Assistant" },
                      ]}
                    />
                    <Input
                      className="min-w-0 flex-1"
                      placeholder="Turn content…"
                      value={t.content}
                      onChange={(e) => setTurn(i, { content: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label="Remove turn"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          turns: (d.turns ?? []).filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {turns.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No turns yet — add the first scripted message.
                  </p>
                )}
              </div>
              {turns.length >= MAX_TURNS && (
                <p className="text-[11px] text-muted-foreground">
                  Limit {MAX_TURNS} turns per injection.
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled !== false}
              onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            />
            Enabled
          </label>
        </DialogPanel>

        <DialogFooter variant="bare" className="border-t border-white/[0.06]">
          {onDelete && (
            <Button variant="ghost" className="mr-auto text-error" onClick={onDelete}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={() =>
              onSave({
                ...draft,
                turns: turns.filter((t) => t.content.trim()),
              })
            }
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  label,
  sublabel,
  onEdit,
  onDelete,
}: {
  entry: InjectionEntry;
  label: string;
  sublabel?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          <Badge variant={entry.enabled ? "success" : "secondary"}>
            {entry.enabled ? "on" : "off"}
          </Badge>
          <Badge variant="secondary">{entry.mode === "chat" ? "chat" : entry.position}</Badge>
          {entry.enabled && entry.templateName ? (
            <Badge variant="outline">from template “{entry.templateName}”</Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted">
          {sublabel ? `${sublabel} · ` : ""}
          ~{estimateTokens(entryText(entry))} tokens
          {!entry.enabled && entry.templateName ? ` · from template “${entry.templateName}”` : ""} ·{" "}
          {entrySummary(entry)} · updated {fmtDate(entry.updatedAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function TemplateRow({
  template,
  onEdit,
  onDelete,
}: {
  template: InjectionTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{template.name}</span>
          <Badge variant="secondary">
            {template.mode === "chat" ? "chat" : template.position}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted">
          ~{estimateTokens(entryText(template))} tokens
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function PromptInjection() {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(null);
  const [saving, setSaving] = useState(false);

  const [keyModel, setKeyModel] = useState("");
  const [newModel, setNewModel] = useState("");
  const [previewModel, setPreviewModel] = useState("");
  const [previewKeyId, setPreviewKeyId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const stateQ = useQuery({
    queryKey: ["prompt-injection"],
    queryFn: getInjectionState,
    enabled: probeEnabled(),
    retry: false,
  });
  const keysQ = useQuery({
    queryKey: ["api-keys", "all"],
    queryFn: () => listApiKeys({ includeRevoked: true }),
    enabled: probeEnabled(),
    retry: false,
  });
  const previewQ = useQuery({
    queryKey: ["prompt-injection", "preview", previewModel, previewKeyId],
    queryFn: () => previewInjections({ model: previewModel.trim(), keyId: previewKeyId }),
    enabled: probeEnabled() && !!previewModel.trim(),
    retry: false,
  });

  const state = stateQ.data ?? {
    global: null,
    byKey: {},
    byModel: {},
    byKeyModel: {},
    templates: [],
  };
  const keys = keysQ.data ?? [];
  const templates = state.templates ?? [];

  const keyEntries = useMemo(
    () => Object.entries(state.byKey ?? {}),
    [state.byKey]
  );
  const modelEntries = useMemo(
    () => Object.entries(state.byModel ?? {}),
    [state.byModel]
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["prompt-injection"] });
  }

  async function handleSave(input: InjectionInput) {
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.kind === "template") {
        await saveTemplate({
          ...input,
          id: editor.templateId,
          name: (input.name ?? "").trim(),
        });
        toast.success("Template saved");
      } else {
        await saveInjection(
          editor.scope ?? "global",
          input,
          { keyId: editor.keyId, model: editor.model }
        );
        toast.success("Prompt injection saved");
      }
      setEditor(null);
      invalidate();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save prompt injection"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editor) return;
    try {
      if (editor.kind === "template") {
        if (editor.templateId) await deleteTemplate(editor.templateId);
        toast.success("Template deleted");
      } else {
        await deleteInjection(editor.scope ?? "global", {
          keyId: editor.keyId,
          model: editor.model,
        });
        toast.success("Prompt injection deleted");
      }
      setEditor(null);
      invalidate();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to delete prompt injection"));
    }
  }

  // ---- Export / Import (file round-trip, 9router-pro compatible) ----
  async function handleExport() {
    try {
      const { data } = await api.get("/prompt-injection");
      const payload = {
        app: "suwokrouter",
        kind: "prompt-injections",
        version: 1,
        ...(data?.state ?? {}),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "prompt-injections.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Export failed");
    }
  }

  async function handleImportFile(file: File) {
    try {
      const data = JSON.parse(await file.text());
      let applied = 0;
      let skipped = 0;
      const put = async (payload: Record<string, unknown>) => {
        try {
          const res = await api.put("/prompt-injection", payload);
          if (res.status >= 200 && res.status < 300) applied++;
          else skipped++;
        } catch {
          skipped++;
        }
      };
      const keyExists = (id: string) => keys.some((k) => k.id === id);

      if (data.global) await put({ scope: "global", entry: data.global });
      // Legacy files (and 9router-pro exports) call templates "presets".
      for (const template of data.templates || data.presets || []) {
        const { targets: _targets, ...rest } = template || {};
        await put({ template: rest });
      }
      for (const [keyId, entry] of Object.entries(data.byKey || {})) {
        if (!keyExists(keyId)) {
          skipped++;
          continue;
        }
        await put({ scope: "key", keyId, entry });
      }
      for (const [model, entry] of Object.entries(data.byModel || {})) {
        await put({ scope: "model", model, entry });
      }
      for (const [keyId, models] of Object.entries(data.byKeyModel || {})) {
        if (!keyExists(keyId)) {
          skipped += Object.keys(models || {}).length || 1;
          continue;
        }
        for (const [model, entry] of Object.entries(models || {})) {
          await put({ scope: "keyModel", keyId, model, entry });
        }
      }
      // 9router-pro shapes: variants/prompts key by model name, userPrompts
      // and keyModelPrompts by API key.
      for (const entry of Object.values(data.variants || {})) {
        const model = (entry as { model?: string })?.model?.trim() || "";
        if (!model) {
          skipped++;
          continue;
        }
        await put({ scope: "model", model, entry });
      }
      for (const [model, entry] of Object.entries(data.prompts || {})) {
        await put({ scope: "model", model, entry });
      }
      for (const [keyId, entry] of Object.entries(data.userPrompts || {})) {
        if (!keyExists(keyId)) {
          skipped++;
          continue;
        }
        await put({ scope: "key", keyId, entry });
      }
      for (const [keyId, models] of Object.entries(data.keyModelPrompts || {})) {
        if (!keyExists(keyId)) {
          skipped += Object.keys(models || {}).length || 1;
          continue;
        }
        for (const [model, entry] of Object.entries(models || {})) {
          await put({ scope: "keyModel", keyId, model, entry });
        }
      }
      toast.success(
        `Imported ${applied} item(s)${skipped ? `, ${skipped} skipped` : ""}`
      );
      invalidate();
    } catch {
      toast.error("Import failed — not a valid injections file");
    }
  }

  const previewStack = (previewQ.data ?? []) as PreviewInjection[];

  return (
    <div className="space-y-6">
      <Header
        title="Prompt Injection"
        description="System prompts and scripted chat history injected into every matching request, stacked global → key → model."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-1 h-4 w-4" /> Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4" /> Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            A library of reusable prompts. Using a template copies its content into an injection — the
            template itself never runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center">
              <BookmarkPlus className="h-6 w-6 text-muted" />
              <p className="text-sm text-muted">
                No templates yet — save a prompt you reuse, then apply it anywhere in one pick.
              </p>
            </div>
          ) : (
            templates.map((tpl) => (
              <TemplateRow
                key={tpl.id}
                template={tpl}
                onEdit={() =>
                  setEditor({
                    kind: "template",
                    title: `Edit template “${tpl.name}”`,
                    templateId: tpl.id,
                    entry: {
                      mode: tpl.mode,
                      content: tpl.content,
                      turns: tpl.turns ?? [],
                      position: tpl.position,
                      enabled: true,
                      name: tpl.name,
                    },
                  })
                }
                onDelete={() =>
                  setEditor({
                    kind: "template",
                    title: `Edit template “${tpl.name}”`,
                    templateId: tpl.id,
                    entry: {
                      mode: tpl.mode,
                      content: tpl.content,
                      turns: tpl.turns ?? [],
                      position: tpl.position,
                      enabled: true,
                      name: tpl.name,
                    },
                  })
                }
              />
            ))
          )}
          <Button
            variant="outline"
            onClick={() =>
              setEditor({ kind: "template", title: "New template", entry: emptyEntry() })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> New template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Global</CardTitle>
          <CardDescription>Applies to every request, regardless of API key or model.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.global ? (
            <EntryRow
              entry={state.global}
              label={state.global.name || "Global injection"}
              onEdit={() =>
                setEditor({
                  kind: "injection",
                  scope: "global",
                  title: "Global prompt injection",
                  entry: entryToInput(state.global!),
                  existing: state.global!,
                })
              }
              onDelete={() =>
                setEditor({
                  kind: "injection",
                  scope: "global",
                  title: "Global prompt injection",
                  entry: entryToInput(state.global!),
                  existing: state.global!,
                })
              }
            />
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                setEditor({
                  kind: "injection",
                  scope: "global",
                  title: "Global prompt injection",
                  entry: emptyEntry(),
                })
              }
            >
              <MessageSquarePlus className="mr-1 h-4 w-4" /> Add global injection
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per API key</CardTitle>
          <CardDescription>Stacks after the global injection, for requests using the selected key.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {keyEntries.map(([keyId, entry]) => (
            <EntryRow
              key={keyId}
              entry={entry}
              label={keys.find((k) => k.id === keyId)?.name || keyId}
              sublabel="API key"
              onEdit={() =>
                setEditor({
                  kind: "injection",
                  scope: "key",
                  title: `Injection for key ${keyId}`,
                  keyId,
                  entry: entryToInput(entry),
                  existing: entry,
                })
              }
              onDelete={() =>
                setEditor({
                  kind: "injection",
                  scope: "key",
                  title: `Injection for key ${keyId}`,
                  keyId,
                  entry: entryToInput(entry),
                  existing: entry,
                })
              }
            />
          ))}
          <div className="flex gap-2">
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={keyModel}
              onChange={(e) => setKeyModel(e.target.value)}
            >
              <option value="">Select API key…</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!keyModel}
              onClick={() =>
                setEditor({
                  kind: "injection",
                  scope: "key",
                  title: "Injection for selected key",
                  keyId: keyModel,
                  entry: emptyEntry(),
                })
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add for key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per model</CardTitle>
          <CardDescription>
            Matches the model name the client asked for — combo name, alias, or provider/model — then the resolved provider/model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {modelEntries.map(([model, entry]) => (
            <EntryRow
              key={model}
              entry={entry}
              label={model}
              sublabel="Model"
              onEdit={() =>
                setEditor({
                  kind: "injection",
                  scope: "model",
                  title: `Injection for ${model}`,
                  model,
                  entry: entryToInput(entry),
                  existing: entry,
                })
              }
              onDelete={() =>
                setEditor({
                  kind: "injection",
                  scope: "model",
                  title: `Injection for ${model}`,
                  model,
                  entry: entryToInput(entry),
                  existing: entry,
                })
              }
            />
          ))}
          <div className="flex gap-2">
            <Input
              placeholder="Model name (e.g. gpt-combo or openai/gpt-4o)"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!newModel.trim()}
              onClick={() =>
                setEditor({
                  kind: "injection",
                  scope: "model",
                  title: `Injection for ${newModel.trim()}`,
                  model: newModel.trim(),
                  entry: emptyEntry(),
                })
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add for model
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>See what would be injected for one model and key combination.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="Model name to preview"
              value={previewModel}
              onChange={(e) => setPreviewModel(e.target.value)}
            />
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={previewKeyId}
              onChange={(e) => setPreviewKeyId(e.target.value)}
            >
              <option value="">No API key</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
          {previewModel.trim() && (
            <div className="space-y-2">
              {previewQ.isLoading && <p className="text-sm text-muted">Loading…</p>}
              {!previewQ.isLoading && previewStack.length === 0 && (
                <p className="text-sm text-muted">Nothing would be injected.</p>
              )}
              {previewStack.map((item, i) => (
                <div key={i} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{i + 1}</Badge>
                    <span className="font-medium">{item.name}</span>
                    <Badge variant="secondary">{item.mode === "chat" ? "chat" : item.position}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                    {item.mode === "chat"
                      ? (item.turns ?? []).map((t) => `${t.role}: ${t.content}`).join("\n")
                      : item.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editor && (
        <InjectionEditor
          editor={editor}
          saving={saving}
          templates={templates}
          onSave={handleSave}
          onClose={() => setEditor(null)}
          onDelete={editor.kind === "template" || editor.existing ? handleDelete : undefined}
        />
      )}
    </div>
  );
}
