const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const ritmo = job.includes('modoRel === "ritmo_analise"') || job.includes('modo === "ritmo_analise"');
if (!ritmo) { console.error("FALHOU: dispatcher ritmo_analise ausente"); Deno.exit(1); }
// O job inteiro continua sem registrar propose_action nas tools do tier profundo.
const blocoTools = job.includes("propose_action");
// propose_action pode aparecer em comentários; o que não pode é estar no array de tools do job.
const toolsJob = job.match(/tools:\s*\[([\s\S]*?)\]/g) ?? [];
for (const t of toolsJob) {
  if (t.includes("propose_action")) {
    console.error("FALHOU: tools do job incluem propose_action");
    Deno.exit(1);
  }
}
console.log("OK ritmo_analise sem card");
