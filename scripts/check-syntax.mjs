import { spawnSync } from "node:child_process";

const files = [
  "app.js",
  "server.js",
  "src/numbering.js",
  "src/status.js",
  "src/permissions.js",
  "src/revisions.js",
  "src/scan.js",
  "src/export.js",
  "playwright.config.mjs",
  "scripts/check-syntax.mjs",
  "scripts/check-markdown-links.mjs",
  "scripts/d1-backup.mjs",
  "tests/ui-smoke.spec.js",
  "backend/bootstrap-admin.js",
  "backend/src/index.js",
];

let failed = false;

for(const file of files){
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    shell: false,
  });

  if(result.status !== 0){
    failed = true;
  }
}

if(failed) process.exit(1);
console.log(`Syntax OK (${files.length} files)`);
