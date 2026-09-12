import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const files = walk("./src");
const uniqueErrors = new Map();
const fileErrors = new Map();

for (const f of files) {
  const r = spawnSync("bun", ["build", "--target=bun", f], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  if (r.error) {
    fileErrors.set(f.split("\\").join("/"), [r.error.message]);
    continue;
  }
  if (r.status === 0) continue;
  const errs = [];
  const diagnostics = `${r.stderr || ""}\n${r.stdout || ""}`;
  const re = /Could not resolve: "([^"]+)"/g;
  let m;
  while ((m = re.exec(diagnostics))) errs.push(m[1]);
  if (errs.length === 0) errs.push(`bun build exited with ${r.status ?? "unknown"}`);
  const rel = f.split("\\").join("/");
  fileErrors.set(rel, [...new Set(errs)]);
  for (const e of new Set(errs)) {
    uniqueErrors.set(e, (uniqueErrors.get(e) || 0) + 1);
  }
}

console.log("=== UNIQUE unresolved specifiers (" + uniqueErrors.size + ") ===");
for (const [spec, count] of uniqueErrors) {
  console.log(spec + "  <- " + count + " file(s)");
}
console.log("");
console.log("=== files with errors: " + fileErrors.size + " of " + files.length + " ===");
if (fileErrors.size > 0) {
  for (const [file, errors] of fileErrors) console.error(`${file}: ${errors.join(", ") || "build failed"}`);
  process.exitCode = 1;
}
