import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function argValue(name, fallback = null){
  const idx = process.argv.indexOf(name);
  if(idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function firstPositional(){
  return process.argv.slice(2).find(arg => !arg.startsWith("--")) || null;
}

function stamp(date = new Date()){
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + "_" + pad(date.getHours()) + pad(date.getMinutes());
}

const database = argValue("--database", firstPositional() || process.env.D1_DATABASE || "komponent_db");
const output = argValue("--output", path.join("backups", `${database}-${stamp()}.sql`));
const remote = process.argv.includes("--local") ? false : true;

fs.mkdirSync(path.dirname(output), { recursive: true });

const args = ["wrangler", "d1", "export", database, "--output", output];
if(remote) args.push("--remote");

console.log(`Exporting D1 database '${database}' to ${output}`);
const result = spawnSync("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
