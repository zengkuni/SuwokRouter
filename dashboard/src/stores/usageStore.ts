import { create } from "zustand";

export type UsageStats = {
  total: number;
  totalCost: number;
  byProvider: Record<
    string,
    {
      requests?: number;
      promptTokens?: number;
      completionTokens?: number;
      cost?: number;
    }
  >;
};

type UsageState = {
  stats: UsageStats | null;
  history: unknown[];
  setStats: (stats: UsageStats | null) => void;
  setHistory: (history: unknown[]) => void;
};

export const useUsageStore = create<UsageState>((set) => ({
  stats: null,
  history: [],
  setStats: (stats) => set({ stats }),
  setHistory: (history) => set({ history }),
}));
