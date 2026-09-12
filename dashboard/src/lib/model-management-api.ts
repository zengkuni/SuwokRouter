import { api } from "@/lib/api";

export type DisabledModels = Record<string, string[]>;

export async function fetchDisabledModels(): Promise<DisabledModels> {
  const { data } = await api.get<{ disabled?: DisabledModels }>("/models/disabled");
  return data.disabled ?? {};
}

export async function disableModels(providerAlias: string, ids: string[]) {
  await api.post("/models/disabled", { providerAlias, ids });
}

export async function enableModel(providerAlias: string, id: string) {
  await api.delete("/models/disabled", {
    params: { providerAlias, id },
  });
}
