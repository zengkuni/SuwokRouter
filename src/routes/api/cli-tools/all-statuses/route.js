"use server";

import { NextResponse } from "next/server";
import { GET as claudeGet } from "../claude-settings/route";
import { GET as codexGet } from "../codex-settings/route";
import { GET as opencodeGet } from "../opencode-settings/route";
import { GET as hermesGet } from "../hermes-settings/route";
import { GET as coworkGet } from "../cowork-settings/route";
import { GET as kiloGet } from "../kilo-settings/route";
import { GET as grokBuildGet } from "../grok-build-settings/route";
import { GET as ompGet } from "../omp-settings/route";

const STATUS_GETTERS = {
  claude: claudeGet,
  codex: codexGet,
  opencode: opencodeGet,
  hermes: hermesGet,
  cowork: coworkGet,
  kilo: kiloGet,
  "grok-build": grokBuildGet,
  omp: ompGet,
};

export async function GET() {
  const entries = await Promise.all(
    Object.entries(STATUS_GETTERS).map(async ([toolId, getter]) => {
      try {
        const res = await getter();
        const data = await res.json();
        return [toolId, data];
      } catch {
        return [toolId, null];
      }
    })
  );
  return NextResponse.json(Object.fromEntries(entries));
}
