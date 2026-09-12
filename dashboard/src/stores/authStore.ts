import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthState = {
  token: string | null;
  authenticated: boolean;
  requireLogin: boolean;
  hasPassword: boolean;
  setToken: (token: string | null) => void;
  setAuthenticated: (value: boolean) => void;
  setAuthMeta: (meta: {
    requireLogin?: boolean;
    hasPassword?: boolean;
    authenticated?: boolean;
  }) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      authenticated: false,
      requireLogin: false,
      hasPassword: false,
      setToken: (token) =>
        set({ token, authenticated: Boolean(token) }),
      setAuthenticated: (authenticated) => set({ authenticated }),
      setAuthMeta: (meta) => set(meta),
      clearAuth: () =>
        set({ token: null, authenticated: false }),
    }),
    {
      name: "nr-auth",
      partialize: (s) => ({
        token: s.token,
        authenticated: s.authenticated,
      }),
    }
  )
);
