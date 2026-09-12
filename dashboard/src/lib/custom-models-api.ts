import { api } from "@/lib/api";

export type CustomModel = {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
  capabilities?: Record<string, unknown>;
  thinkingLevels?: string[] | null;
};

export async function listCustomModelsAPI(
  _provider?: string
): Promise<CustomModel[]> {

  const { data } = await api.get<{ models: CustomModel[] }>("/models/custom");
  return data.models ?? [];
}

export async function addCustomModelsAPI(
  provider: string,
  models: Array<string | { id: string; name?: string; capabilities?: Record<string, unknown> }>,
): Promise<{ added: number; total: number; models: CustomModel[] }> {

  let added = 0;
  for (const model of models) {
    try {
      const item = typeof model === "string" ? { id: model } : model;
      const result = await addCustomModelAPI(provider, item.id, item.name, item.capabilities);

      added += result.added;
    } catch {

    }
  }
  const models_ = await listCustomModelsAPI(provider);
  return { added, total: models_.length, models: models_ };
}

export async function addCustomModelAPI(
  provider: string,
  id: string,
  name?: string,
  capabilities?: Record<string, unknown>,
): Promise<{ added: number; total: number; models: CustomModel[] }> {

  const { data: result } = await api.post<{ added?: boolean }>("/models/custom", {
    providerAlias: provider,
    id,
    name,
    capabilities,
  });
  const models = await listCustomModelsAPI(provider);
  return { added: result.added === true ? 1 : 0, total: models.length, models };
}

export async function removeCustomModelAPI(
  provider: string,
  id: string
): Promise<{ success: boolean; removed: boolean }> {

  const { data } = await api.delete<{ success: boolean }>("/models/custom", {
    params: { providerAlias: provider, id },
  });
  return { success: data.success !== false, removed: data.success !== false };
}
