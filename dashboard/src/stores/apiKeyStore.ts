import { create } from "zustand";
import type { ApiKey } from "@/lib/api-keys-api";

export type { ApiKey };

type ApiKeyState = {
  keys: ApiKey[];
  setKeys: (keys: ApiKey[]) => void;
  upsertKey: (key: ApiKey) => void;
  removeKey: (id: string) => void;
};

export const useApiKeyStore = create<ApiKeyState>((set) => ({
  keys: [],
  setKeys: (keys) => set({ keys }),
  upsertKey: (key) =>
    set((s) => {
      const idx = s.keys.findIndex((k) => k.id === key.id);
      if (idx === -1) return { keys: [key, ...s.keys] };
      const next = s.keys.slice();
      next[idx] = { ...next[idx], ...key };
      return { keys: next };
    }),
  removeKey: (id) =>
    set((s) => ({ keys: s.keys.filter((k) => k.id !== id) })),
}));
