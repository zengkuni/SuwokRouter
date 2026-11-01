import { api } from "@/lib/api";

export type InjectPosition = "prepend" | "append";
export type InjectMode = "single" | "chat";

// Mirrors the backend cap in src/lib/db/repos/promptInjectRepo.js (cleanTurns):
// turns beyond this are silently dropped server-side, so the editor stops at it.
export const MAX_TURNS = 50;

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type InjectionEntry = {
  mode: InjectMode;
  content: string;
  turns: ChatTurn[];
  position: InjectPosition;
  enabled: boolean;
  name: string | null;
  templateName: string | null;
  updatedAt: string | null;
};

// A saved prompt in the library — same body as an entry, no target.
export type InjectionTemplate = {
  id: string;
  name: string;
  mode: InjectMode;
  content: string;
  turns: ChatTurn[];
  position: InjectPosition;
};

export type InjectionState = {
  global: InjectionEntry | null;
  byKey: Record<string, InjectionEntry>;
  byModel: Record<string, InjectionEntry>;
  byKeyModel: Record<string, Record<string, InjectionEntry>>;
  templates: InjectionTemplate[];
};

export type InjectionScope = "global" | "key" | "model" | "keyModel";

export type InjectionInput = {
  mode: InjectMode;
  content?: string;
  turns?: ChatTurn[];
  position?: InjectPosition;
  enabled?: boolean;
  name?: string | null;
  templateName?: string | null;
};
export type PreviewInjection = {
  name: string;
  mode: InjectMode;
  text?: string;
  turns?: ChatTurn[];
  position: InjectPosition;
};

export async function getInjectionState(): Promise<InjectionState> {
  const { data } = await api.get("/prompt-injection");
  return (data?.state ?? {
    global: null,
    byKey: {},
    byModel: {},
    byKeyModel: {},
    templates: [],
  }) as InjectionState;
}

export async function previewInjections(params: {
  model: string;
  keyId?: string;
}): Promise<PreviewInjection[]> {
  const { data } = await api.get("/prompt-injection", {
    params: { preview: 1, model: params.model, keyId: params.keyId || "" },
  });
  return (data?.stack ?? []) as PreviewInjection[];
}

export async function saveInjection(
  scope: InjectionScope,
  entry: InjectionInput,
  target: { keyId?: string; model?: string } = {}
): Promise<InjectionEntry> {
  const { data } = await api.put("/prompt-injection", {
    scope,
    entry,
    keyId: target.keyId,
    model: target.model,
  });
  return data.entry as InjectionEntry;
}

export async function deleteInjection(
  scope: InjectionScope,
  target: { keyId?: string; model?: string } = {}
): Promise<boolean> {
  const { data } = await api.delete("/prompt-injection", {
    params: { scope, keyId: target.keyId || "", model: target.model || "" },
  });
  return data?.removed === true;
}

export async function saveTemplate(
  input: InjectionInput & { id?: string; name: string }
): Promise<InjectionTemplate> {
  const { data } = await api.put("/prompt-injection", { template: input });
  return data.template as InjectionTemplate;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { data } = await api.delete("/prompt-injection", {
    params: { templateId: id },
  });
  return data?.removed === true;
}
