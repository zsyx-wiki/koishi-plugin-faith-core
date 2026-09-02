const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const output = path.resolve(__dirname, "../src/data");

function loadTypescriptData(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", "__filename", "__dirname", compiled)(
    module.exports,
    module,
    require,
    filename,
    path.dirname(filename),
  );
  return module.exports;
}

function stableId(prefix, name) {
  return `${prefix}_${crypto.createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}

const levels = { 1: "D", 2: "C", 3: "B", 4: "A", 5: "S", 6: "SS", 7: "SSS", 8: "SP" };
const prices = { D: 15, C: 35, B: 90, A: 250, S: 750, SS: 3000, SSS: 10000, SP: 50000 };
const { rawCardData } = loadTypescriptData("src/data/items.ts");
const { rawEasterEggData } = loadTypescriptData("src/data/easterEggs.ts");

const names = new Set();
function assertUnique(name) {
  if (names.has(name)) throw new Error(`重复物品名称：${name}`);
  names.add(name);
}

const items = rawCardData.map((item) => {
  assertUnique(item.name);
  const level = levels[item.level] ?? "D";
  const marketable = item.card === "道具" || item.card === "天赋";
  return {
    item_id: stableId("faith_item", item.name),
    name: item.name,
    type: item.card,
    level,
    description: item.text ?? "",
    max_quantity: 0,
    marketable,
    price: marketable ? prices[level] ?? 0 : 0,
    obtainable: true,
  };
});

const eggs = rawEasterEggData.map((item) => {
  assertUnique(item.name);
  return {
    item_id: stableId("faith_easter_egg", item.name),
    name: item.name,
    type: "彩蛋",
    level: "彩蛋",
    description: item.text ?? "",
    max_quantity: 1,
    marketable: false,
    price: 0,
    obtainable: item.output,
    actions: item.action ?? [],
  };
});

function writeTypescript(filename, exportName, values) {
  const source = [
    'import type { FaithItemDefinition } from "../types";',
    "",
    `export const ${exportName} = ${JSON.stringify(values, null, 2)} as const satisfies readonly FaithItemDefinition[];`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(output, filename), source);
}

writeTypescript("items.ts", "CORE_ITEMS", items);
writeTypescript("easterEggs.ts", "CORE_EASTER_EGGS", eggs);
console.log(`迁移完成：${items.length} 个普通物品，${eggs.length} 个彩蛋。`);
