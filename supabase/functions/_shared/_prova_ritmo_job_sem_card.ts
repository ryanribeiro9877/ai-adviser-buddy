const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const ritmo = job.includes('modoRel === "ritmo_analise"') || job.includes('modo === "ritmo_analise"');
if (!ritmo) { console.error("FALHOU: dispatcher ritmo_analise ausente"); Deno.exit(1); }
const replano = job.includes('modoRel === "ritmo_replano"') || job.includes('modo === "ritmo_replano"');
if (!replano) { console.error("FALHOU: dispatcher ritmo_replano ausente"); Deno.exit(1); }
if (!job.includes("processarRitmoReplano")) {
  console.error("FALHOU: processarRitmoReplano ausente");
  Deno.exit(1);
}
if (!job.includes("isto e REPLANO de missao em execucao; compare realizado vs projecao; so desvie com evidencia nova; dissertacao e metrica e teto permanecem")) {
  console.error("FALHOU: prompt extra ritmo_replano ausente");
  Deno.exit(1);
}
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
if (!job.includes('typeof raw.leitura === "string"') || !job.includes("{ texto: raw.leitura }")) {
  console.error("FALHOU: coerce de leitura string ausente apos extrairJsonRitmo");
  Deno.exit(1);
}
console.log("OK ritmo_analise e ritmo_replano sem card");
