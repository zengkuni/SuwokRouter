import { cookieStoreAls } from "./server.js";

export function cookies() {
  const store = cookieStoreAls.getStore();
  if (!store) throw new Error("cookies() called outside request scope");
  return store.cookies;
}

export function headers() {
  const store = cookieStoreAls.getStore();
  return store ? store.headers : new Headers();
}
