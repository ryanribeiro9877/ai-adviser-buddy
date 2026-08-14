// Prova de regressao para guardas que precisam permanecer nos dois caminhos do agente.
// Rode: deno run --allow-read supabase/functions/_shared/_prova_isolamento_empresas.ts
const chat = await Deno.readTextFile(
  new URL("../traffic-chat/index.ts", import.meta.url),
);
const job = await Deno.readTextFile(
  new URL("../traffic-agent-job/index.ts", import.meta.url),
);

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

for (const [name, source] of [["chat", chat], ["job", job]] as const) {
  assert(
    source.includes("if (!data?.length || !name?.trim()) return null"),
    `${name}: empresa ausente deve falhar fechado`,
  );
  assert(
    source.includes('.select("id,company_id").eq("id", convId)'),
    `${name}: conversa deve carregar company_id`,
  );
  assert(
    source.includes('return json({ error: "conversation_company_mismatch" }, 409)'),
    `${name}: conversa cruzada deve ser recusada`,
  );
}

assert(
  !job.includes("Voce e o Gestor de Trafego IA da Legal e Viver"),
  "job: sintese nao pode fixar Legal e Viver",
);
assert(
  job.includes('p_company_id: companyId') &&
    job.includes('case "get_estrutura_conjuntos": return await t_estrutura_conjuntos(ctx.companyId)'),
  "job: estrutura deve ser escopada pela empresa",
);
assert(
  chat.includes("nenhuma_pasta_drive_configurada_para_esta_empresa") &&
    job.includes("nenhuma_pasta_drive_configurada_para_esta_empresa"),
  "Drive deve falhar fechado nos dois caminhos",
);
assert(
  chat.includes("company_id: companyId") &&
    job.includes("JSON.stringify({ company_id: companyId, legenda })"),
  "compliance deve receber company_id",
);

console.log("ok: _prova_isolamento_empresas");
