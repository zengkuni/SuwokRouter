import { describe, expect, test } from "bun:test";
import { __test__ } from "./route.js";

describe("settings response serialization", () => {
  test("omits server-owned database paths and secrets", () => {
    const result = __test__.sanitizeSettingsForResponse({
      requireLogin: true,
      dbPath: "/srv/swayrouter/db/data.sqlite",
      password: "$2b$10$stored-hash",
      oidcClientSecret: "oidc-secret",
      oidcIssuerUrl: "https://issuer.example",
      oidcClientId: "router",
    });

    expect(result).toEqual({
      requireLogin: true,
      oidcIssuerUrl: "https://issuer.example",
      oidcClientId: "router",
      oidcConfigured: true,
    });
    expect(result).not.toHaveProperty("dbPath");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("oidcClientSecret");
  });

  test("does not preserve a client-supplied dbPath", () => {
    const result = __test__.sanitizeSettingsForResponse({
      dbPath: "C:\\Users\\operator\\database.sqlite",
      requireApiKey: false,
    });

    expect(result).toEqual({
      requireApiKey: false,
      oidcConfigured: false,
    });
  });
});
