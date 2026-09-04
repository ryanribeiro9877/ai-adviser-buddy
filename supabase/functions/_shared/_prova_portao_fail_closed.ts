// Prova de que NENHUM consumidor do portao de compliance pode aprovar por OMISSAO.
//
// POR QUE ESTE ARQUIVO EXISTE, com o caso concreto. Em 03/09/2026, apurando se o audio dos
// videos da COHAPM carregava risco que a tela nao mostrava, a comparacao foi escrita lendo
// `resultado->>'aprovado'`. Essa chave NAO EXISTE no retorno de `checar_promessas_proibidas`,
// que devolve `bloqueios` e `atencoes`. Toda leitura deu NULL, NULL foi interpretado como
// "sem risco", e a conclusao a um passo de ser reportada era "o audio nao adiciona risco" —
// baseada em nada. O que desmentiu foi um CONTROLE POSITIVO: um texto que TINHA de ser
// barrado, e nao foi. Sem esse controle, o achado de compliance teria sido enterrado por uma
// chave escrita errado.
//
// E o TERCEIRO episodio do mesmo defeito neste projeto:
//   - `get_notificacoes_pendentes`: comparacao de `status::text` zerava as aprovacoes em silencio;
//   - auditoria de 13/08: 10 de 12 funcoes devolviam 404 que era `PGRST202` (argumento faltando),
//     e o teste por HTTP "confirmou" um conserto que era no-op;
//   - 03/09: a chave `aprovado` inexistente virando aprovacao.
//
// A licao repetida, e a razao desta prova ser de CODIGO e nao de dado: **status ausente nao e
// status seguro**. O defeito nunca aparece na operacao normal, porque tudo continua passando.
// Ele so aparece quando alguem desconfia — e desconfiança nao e mecanismo.
//
// O QUE ESTA PROVA COBRE (leitura de fonte) e O QUE ELA NAO COBRE. Aqui se verifica que os
// consumidores estao ESCRITOS em fail-closed. O controle positivo de COMPORTAMENTO — texto que
// tem de ser barrado de fato — vive no banco, em `public.provar_portao_de_compliance()`, porque
// depende das regras de `promessas_proibidas`, e roda diariamente pelo cron
// `vigia-portao-compliance-0955`. Os dois se completam: esta prova pega o consumidor que
// afrouxa a leitura; a do banco pega o portao que morre. Nenhuma das duas sozinha bastaria.
//
// Roda com: deno run --allow-all supabase/functions/_shared/_prova_portao_fail_closed.ts

const falhas: string[] = [];

function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

async function fonte(caminho: string): Promise<string> {
  return await Deno.readTextFile(new URL(caminho, import.meta.url));
}

// ---------------------------------------------------------------------------
// 1) gerar-legendas: resposta VAZIA sem erro nao pode virar variante apta.
//
// A versao anterior tratava `parErr`, mas nao tratava `parData` nulo: `verdPar` virava "",
// "" nao contem "reprov", e a variante saia apta. Verificador que nao respondeu liberava a
// publicacao.
// ---------------------------------------------------------------------------
{
  const src = await fonte("../gerar-legendas/index.ts");
  ok(
    /checar_par_texto_e_peca/.test(src),
    "gerar-legendas deveria consultar checar_par_texto_e_peca",
  );
  ok(
    /!parData\s*\|\|\s*typeof parData !== "object"/.test(src),
    "gerar-legendas tem de recusar resposta VAZIA do par (parData nulo/nao-objeto), " +
      "senao verificador mudo libera a publicacao",
  );
  ok(
    /LIBERADOS/.test(src) && /LIBERADOS\.includes\(/.test(src),
    "gerar-legendas tem de decidir por LISTA DE LIBERADOS, nao por ausencia de 'reprov': " +
      "vocabulario novo no veredito nao pode passar calado",
  );
}

// ---------------------------------------------------------------------------
// 2) meta-actions: o executor que GASTA dinheiro e o ultimo portao. Igualdade exata com
// "reprova" deixava passar qualquer veredito desconhecido, porque `undefined === "reprova"`
// e falso — e falso ali significa publicar.
// ---------------------------------------------------------------------------
{
  const src = await fonte("../meta-actions/index.ts");
  ok(
    /VER_LIBERADOS/.test(src) && /!VER_LIBERADOS\.includes\(/.test(src),
    "meta-actions tem de bloquear o que NAO esta explicitamente liberado, " +
      "em vez de bloquear so o literal 'reprova'",
  );
  ok(
    /if \(parErr \|\| !par\)/.test(src),
    "meta-actions tem de continuar fail-closed quando a RPC do par nao responde",
  );
  ok(
    !/veredito === "reprova"/.test(src),
    "meta-actions nao pode voltar a decidir por igualdade exata com 'reprova'",
  );
}

// ---------------------------------------------------------------------------
// 3) A CHAVE FANTASMA, na forma que causa dano. `aprovado` nao existe em retorno algum do
// compliance: `compliance-check` devolve `veredito: "aprovado"`, e o portao de promessas
// devolve `bloqueia`/`bloqueios`. Ler essa chave e sempre ler `undefined`.
//
// MAS a leitura so e PERIGOSA quando a ausencia produz liberacao. A distincao e o coracao
// desta asserção, e ignorá-la geraria alarme falso em codigo correto:
//
//   `x.aprovado === true`    -> ausente da FALSO -> nao libera. Codigo morto, inofensivo.
//                               (traffic-chat, waba-template-create/replicate estao aqui.)
//   `x.aprovado !== false`   -> ausente da VERDADEIRO -> LIBERA. Este e o defeito.
//   `!x.aprovado`            -> idem, na forma negada.
//   `(...->>'aprovado')::boolean is false` -> NULL nao e false -> LIBERA. Foi a forma exata
//                               do episodio de 03/09/2026.
//
// Entao a prova casa os idiomas em que o silencio vira "sim", e deixa passar os em que o
// silencio vira "nao". Se aparecer um idioma novo de aprovacao-por-ausencia, ele entra aqui.
// ---------------------------------------------------------------------------
{
  const PERIGOSOS: Array<[RegExp, string]> = [
    [/aprovado["']?\s*\]?\s*!==\s*false/, "aprovado !== false (ausente libera)"],
    [/!\s*[\w?.]*\.aprovado\b/, "!x.aprovado (ausente libera)"],
    [/->>\s*'aprovado'\s*\)?\s*(::boolean)?\s*is\s+(false|not\s+true)/i, "->>'aprovado' is false (ausente libera)"],
  ];
  const suspeitos: string[] = [];
  for await (const dir of Deno.readDir(new URL("../", import.meta.url))) {
    if (!dir.isDirectory) continue;
    let src: string;
    try {
      src = await fonte(`../${dir.name}/index.ts`);
    } catch {
      continue; // pasta sem index.ts (ex.: _shared) nao e edge
    }
    for (const [re, nome] of PERIGOSOS) {
      if (re.test(src)) suspeitos.push(`${dir.name}: ${nome}`);
    }
  }
  ok(
    suspeitos.length === 0,
    "leitura em que a AUSENCIA de sinal vira aprovacao (o defeito de 03/09/2026): " +
      suspeitos.join(" | "),
  );
}

// ---------------------------------------------------------------------------
// 4) O controle de COMPORTAMENTO existe e esta versionado. Esta prova nao consegue rodar SQL,
// mas consegue impedir que o controle positivo do banco seja apagado sem ninguem notar: se a
// migration que o cria desaparecer, esta asserção cai.
// ---------------------------------------------------------------------------
{
  const migs: string[] = [];
  for await (const f of Deno.readDir(new URL("../../migrations/", import.meta.url))) {
    if (f.isFile && f.name.endsWith(".sql")) migs.push(f.name);
  }
  let temControle = false;
  for (const nome of migs) {
    const src = await fonte(`../../migrations/${nome}`);
    if (/create or replace function public\.provar_portao_de_compliance/.test(src)) {
      temControle = true;
      break;
    }
  }
  ok(
    temControle,
    "a migration que cria public.provar_portao_de_compliance() sumiu: sem ela o portao pode " +
      "morrer sem que teste algum perceba (o controle de comportamento vive no banco)",
  );
}

// ---------------------------------------------------------------------------

if (falhas.length > 0) {
  console.error("FALHOU: o portao de compliance pode aprovar por omissao.\n");
  for (const f of falhas) console.error(`  - ${f}`);
  console.error(
    "\nLembrete do porque isto e bloqueante: ausencia de sinal NAO e sinal de seguranca. " +
      "Em 03/09/2026 uma chave escrita errado quase enterrou um achado de compliance.",
  );
  Deno.exit(1);
}

console.log(
  `OK  portao fail-closed em 4 frentes: resposta vazia, vocabulario desconhecido, ` +
    `chave fantasma 'aprovado' e existencia do controle positivo no banco.`,
);
