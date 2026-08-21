import fs from "fs";
const t = fs.readFileSync("supabase/functions/_shared/geo_preset_juridico.ts", "utf8");
const m = t.match(/BAIRROS_CANONICOS_JURIDICO_SALVADOR[^=]*=\s*\[([\s\S]*?)\];/);
if (!m) throw new Error("array not found");
const arr = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
console.log("count", arr.length);
fs.writeFileSync("scripts/bairros_canon.json", JSON.stringify(arr, null, 2));
