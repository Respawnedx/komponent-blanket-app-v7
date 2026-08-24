import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const markdownFiles = [];

function walk(dir){
  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    if(entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) walk(full);
    else if(entry.isFile() && entry.name.toLowerCase().endsWith(".md")) markdownFiles.push(full);
  }
}

walk(root);

const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
const missing = [];

for(const file of markdownFiles){
  const text = fs.readFileSync(file, "utf8");
  for(const match of text.matchAll(linkRe)){
    const target = match[1].trim();
    if(!target || /^(https?:|mailto:|#)/i.test(target)) continue;

    const withoutHash = target.split("#")[0];
    if(!withoutHash) continue;

    const resolved = path.resolve(path.dirname(file), withoutHash);
    if(!fs.existsSync(resolved)){
      missing.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
}

if(missing.length){
  console.error("Broken markdown links:");
  for(const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Markdown links OK (${markdownFiles.length} files)`);
