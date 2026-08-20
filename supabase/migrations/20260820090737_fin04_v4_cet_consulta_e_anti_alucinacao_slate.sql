-- 20/08/2026: fecha duas falhas do agente no chat de criativos.
--
-- (A) CET: o gestor pediu "consulte o CET na sua simulacao". O agente ACEITOU e depois
--     RECUSOU pedindo numero real (X%/Y%/Z%). Isso e falso. FIN-04 exige a mencao ao CET
--     na legenda, NAO um percentual percentual. "Consulte o CET..." contem CET e passa no padrao
--     (exige_presenca_de='CET'). O exemplo antigo "CET de X% a Y%" foi lido como obrigacao
--     de preencher placeholder — reescrevemos a regra e o exemplo.
--
-- (B) Alucinacao de slate: o gestor processou 3 videos + 1 card + 1 carrossel (=5 pecas).
--     O agente passou a citar "5 videos 22-27" porque a doutrina/tool description listava
--     esses videos como inventário liberado. Inventario apto ≠ pedido vigente.

-- 1) FIN-04 v4: CET por consulta e valido; numero NAO e obrigatorio
update public.compliance_rules set active = false where code = 'FIN-04' and version = 3;

insert into public.compliance_rules (code, categoria, severidade, regra, fonte, exemplos_violacao, version, active)
values ('FIN-04', 'ambos', 'bloqueia',
 'Quando o ANUNCIO citar TAXA de juros, PRAZO de pagamento ou VALOR DE PARCELA - esteja o numero na LEGENDA DA PUBLICACAO ou exibido dentro da PECA -, a LEGENDA DA PUBLICACAO precisa trazer o CET (Custo Efetivo Total) OU uma referencia explicita para consultar o CET na simulacao/oferta, mais a ressalva de credito sujeito a analise/aprovacao (e margem quando aplicavel). '
 || 'O QUE SATISFAZ O CET (qualquer um): (1) "consulte o CET na sua simulacao" / "consulte o CET da oferta na simulacao"; (2) CET com numero real quando a empresa tiver taxa oficial vigente. '
 || 'O QUE ISTO NAO EXIGE: NAO exige percentual numerico de CET na legenda. NAO exige "taxa a partir de X%". NAO trate placeholder de exemplo (X%%/Y%%/Z%%) como pendencia do gestor. Se o gestor definiu a formulacao de consulta, ACEITE e NAO peca numero depois. '
 || 'O QUE ISTO NAO EXIGE da peca: nao exige CET DENTRO do video. '
 || 'RESSALVA DE POSICIONAMENTO: em Reels/Stories a legenda pode truncar — declare o risco, nao invente bloqueio. '
 || 'SE A LEGENDA NAO TROUXER CET NEM referencia de consulta E houver numero em qualquer um dos dois lugares, reprova.',
 'Res. CMN 4.935/2021 + CDC art. 52. Reescrita 20/08/2026 apos o agente aceitar "consulte o CET na simulacao" e depois exigir numero — contradicao proibida.',
 'REPROVAM: legenda com "taxa de 1,29% a.m." sem CET nem consulta · legenda limpa mas peca com "12x de R$ 250" e legenda sem CET/consulta. PASSA: "consulte o CET na sua simulacao" + "credito sujeito a analise". PASSA: CET numerico oficial quando existir. NAO reprova por ausencia de percentual se a consulta ao CET esta na legenda.',
 4, true);

-- 2) Observacao no padrao FIN-04 de promessas_proibidas
update public.promessas_proibidas
   set observacao = coalesce(observacao,'') || ' | 20/08/2026: a string CET em "consulte o CET na sua simulacao" SATISFAZ exige_presenca_de. Nao exige percentual numerico.'
 where active and regra_code = 'FIN-04' and severidade = 'bloqueia';

-- 3) Memoria do agente
update public.agent_context
   set vigente = false
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and vigente
   and (
     fato like 'VIDEOS 22/23/25/26/27 LIBERADOS%'
     or fato like 'FIN-04 LIBERADO 20/08/2026%'
     or fato like 'LEITURA TOTAL DO ACERVO (atualizado 20/08/2026)%'
     or fato ilike '%CET + ressalva (taxa a partir de%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente)
values
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'CET NA LEGENDA (FIN-04 v4, 20/08/2026, decisao do gestor): "consulte o CET na sua simulacao" (ou equivalente) E SUFICIENTE e APROVADO. NAO peca percentual numerico de CET. NAO diga que X%/Y%/Z% e pendencia. NAO aceite e depois recuse a mesma formulacao. Numero de CET so entra se a empresa fornecer taxa oficial vigente — hoje NAO ha taxa fixa cadastrada. Ressalva "credito sujeito a analise/aprovacao" continua obrigatoria quando houver numero na peca ou na legenda.',
  true
),
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'SLATE DO GESTOR ≠ INVENTARIO LIBERADO (20/08/2026): pecas liberadas FIN-04 (videos 22/23/25/26/27) sao inventario APTO, nao o pedido. Se o gestor definiu um lote (ex.: 3 videos + 1 carrossel + 1 card estatico), esse e o slate vigente — cite ESSAS pecas, nessa composicao. PROIBIDO substituir por "5 videos 22-27" ou qualquer outro conjunto. Antes de emitir/auditar, repita o slate literal (tipos + nomes). Se o historico divergir, peca confirmacao; nao invente.',
  true
),
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'VIDEOS 22/23/25/26/27: liberados_como_esta sob FIN-04 v4 (aptos). Sao candidatos do ACERVO, nao um lote automatico. Condicao de publicacao: legenda com CET (consulta na simulacao basta) + ressalva de analise.',
  true
);
