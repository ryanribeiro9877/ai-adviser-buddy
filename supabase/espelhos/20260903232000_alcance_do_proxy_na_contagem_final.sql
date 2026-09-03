-- O alcance do proxy Pipeboard na contagem FINAL, medida depois do controle entrar no ar
-- (03/09/2026, correcao do fato gravado por 20260903231000)
--
-- POR QUE EXISTE ESTA MIGRATION. A anterior gravou a fotografia do catalogo do jeito que ela
-- foi MEDIDA: 121 ferramentas, 58 de leitura, 61 de escrita e 2 leituras que a allowlist de
-- nome recusava por grafia (bulk_search_interests e search). Essa contagem descreve o estado
-- ANTES do conserto do prefixo bulk_search_ — e o conserto entrou na mesma entrega. Reenumerado
-- o catalogo com pipeboard-read ja publicado (request 9894, HTTP 200, 03/09/2026):
--
--   total no conector .................. 121
--   alcancaveis por ler_pipeboard ......  59   (58 de antes + bulk_search_interests)
--   recusadas ..........................  62   (61 de escrita + `search`, por isolamento)
--   nome de leitura que o servidor desmente 0   (o quadrante do furo, ainda vazio)
--
-- O NUMERO QUE O AGENTE PRECISA E O ALCANCAVEL, nao o da medicao intermediaria. O fato de
-- agent_context e lido pelo modelo dentro do turno: se ele diz 58 e a mesa tem 59, o agente
-- pode concluir que a ferramenta que sobrou nao existe e recusar um pedido que ele conseguiria
-- atender. Registro errado e pior que registro incompleto, e isso vale tambem para o registro
-- de doutrina — nao so para o de ferramentas.
--
-- O UPDATE substitui o texto no lugar de inserir um segundo fato: duas versoes vigentes da
-- mesma contagem colocariam o modelo para escolher entre dois numeros nossos, que e o pior dos
-- dois mundos.

update public.agent_context
   set fato =
  'ALCANCE DO PROXY PIPEBOARD, ENUMERADO (03/09/2026). O conector expoe 121 ferramentas. '
  || 'ler_pipeboard alcanca 59 (as de leitura) e RECUSA 62 antes de sair da nossa rede: 61 sao '
  || 'de ESCRITA (create_/update_/delete_/duplicate_/upload_/publish_/manage_/add_/remove_/'
  || 'submit_ e os lotes bulk_create_/bulk_update_/bulk_upload_, incluindo create_campaign, '
  || 'create_adset, create_ad, create_ad_creative, update_adset, update_campaign, '
  || 'duplicate_adset e create_creatives_from_drive_folder) e 1 e recusada por ISOLAMENTO e nao '
  || 'por efeito: `search` e leitura, mas nao aceita account_id e varreria contas de outras '
  || 'empresas do mesmo conector. NUNCA prometa ao gestor um ato pelo ler_pipeboard e nunca diga '
  || 'que "da para criar direto no Pipeboard": a chamada volta com ferramenta_de_escrita_recusada '
  || 'e nenhum objeto e tocado. Todo ato na conta Meta continua sendo propose_action, com card de '
  || 'aprovacao e execucao por meta-actions. Para saber o que EXISTE do lado de la use '
  || 'listar_ferramentas_pipeboard, que devolve exatamente o lado alcancavel.',
       desde = current_date
 where vigente is true
   and company_id is null
   and fato ilike 'ALCANCE DO PROXY PIPEBOARD%';

-- A migration se prova: um fato vigente, com a contagem final, e nenhum sobrevivente da
-- contagem intermediaria.
do $$
declare
  n_vigentes int;
  n_velhos int;
begin
  select count(*) into n_vigentes
    from public.agent_context
   where vigente is true and company_id is null and fato ilike 'ALCANCE DO PROXY PIPEBOARD%';
  if n_vigentes <> 1 then
    raise exception 'esperava 1 fato vigente de alcance do proxy, achei %', n_vigentes;
  end if;
  select count(*) into n_velhos
    from public.agent_context
   where vigente is true and company_id is null
     and fato ilike 'ALCANCE DO PROXY PIPEBOARD%'
     and fato like '%121 ferramentas: 58 de%';
  if n_velhos <> 0 then
    raise exception 'a contagem intermediaria (58 de leitura) continua vigente';
  end if;
end $$;
