export type CacheDisplayInput = {
  cachedTokens?: number;
  cacheCreationTokens?: number;
};

export type CacheDisplay = {
  hit: boolean;
  readTokens: number;
  creationTokens: number;
  label: string;
  title: string;
};

function finiteTokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function getCacheDisplay(row: CacheDisplayInput): CacheDisplay {
  const readTokens = finiteTokens(row.cachedTokens);
  const creationTokens = finiteTokens(row.cacheCreationTokens);
  const hit = readTokens > 0;
  const parts = [hit ? `HIT · ${readTokens.toLocaleString("id-ID")}` : "MISS"];
  if (creationTokens > 0) {
    parts.push(`+${creationTokens.toLocaleString("id-ID")}`);
  }

  return {
    hit,
    readTokens,
    creationTokens,
    label: parts.join(" "),
    title: hit
      ? `Cache hit: ${readTokens.toLocaleString("id-ID")} tokens read${creationTokens > 0 ? `; ${creationTokens.toLocaleString("id-ID")} tokens created` : ""}`
      : creationTokens > 0
        ? `Cache miss: ${creationTokens.toLocaleString("id-ID")} tokens created`
        : "Cache miss: no cached tokens read",
  };
}
