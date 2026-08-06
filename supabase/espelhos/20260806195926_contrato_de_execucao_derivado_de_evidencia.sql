-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806195926
-- name: contrato_de_execucao_derivado_de_evidencia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONTRATO DE EXECUCAO · a lista de campos sai da minha cabeca e vai para uma tabela.
--
-- O ERRO QUE ISTO CORRIGE: pedido_de_anuncio_completo falhou TRES vezes em ser completa porque eu
-- escrevi a lista de campos obrigatorios por DEDUCAO. O Ryan pediu que eu derivasse do codigo que
-- executa - e essa e justamente a coisa que eu NAO consigo fazer: o executor e o meta-actions, em
-- TypeScript no repositorio. Do banco eu vejo o resultado, nao o contrato.
--
-- ENTAO NAO DEDUZO DE NOVO. A lista passa a viver em tabela e so entra por EVIDENCIA:
--   criar_campanha e criar_conjunto_a_partir_de -> semeados a partir dos payloads de cards que
--     EXECUTARAM com sucesso (execution_result.ok = true). Isso e prova, nao suposicao.
--   criar_anuncio_a_partir_de -> FICA VAZIO. Nunca existiu card de anuncio executado, entao nao ha
--     evidencia. E funcao que valida contra contrato vazio deve RECUSAR, nao adivinhar.
--
-- O GANHO: a quarta tentativa deixa de ser um palpite melhor e passa a ser uma recusa honesta. Em
-- vez de montar um card que falha na execucao, o sistema diz que nao conhece o contrato e aponta
-- quem sabe. Quando o Code declarar os campos do anuncio, uma linha de INSERT liga a rota - sem
-- deploy e sem eu deduzir nada.

create table if not exists public.contrato_de_execucao (
  id uuid primary key default gen_random_uuid(),
  acao text not null,
  campo text not null,
  obrigatorio boolean not null,
  tipo text not null,
  observacao text,
  fonte text not null,
  vigente boolean not null default true,
  constraint contrato_unico unique (acao, campo, vigente)
);

comment on table public.contrato_de_execucao is
  'Campos que o executor (meta-actions) exige por acao. So entra por EVIDENCIA: payload de card que executou com sucesso, ou declaracao explicita de quem le o codigo do executor. Acao sem linhas aqui = contrato DESCONHECIDO, e pedido para ela deve ser RECUSADO, nao adivinhado.';

alter table public.contrato_de_execucao enable row level security;
drop policy if exists contrato_leitura on public.contrato_de_execucao;
create policy contrato_leitura on public.contrato_de_execucao for select to authenticated using (true);

-- Semeado do payload do card f9a17ed1 (conjunto [TESTE-GT02]), que executou em 04/08 com
-- execution_result.ok = true e id_criado 120254208284780191. Evidencia, nao deducao.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
('criar_conjunto_a_partir_de','nome_novo',true,'text',null,'payload do card f9a17ed1, executado com sucesso em 04/08/2026'),
('criar_conjunto_a_partir_de','molde_external_id',true,'text','id do conjunto usado como molde','idem'),
('criar_conjunto_a_partir_de','campanha_destino_external_id',true,'text',null,'idem'),
('criar_conjunto_a_partir_de','orcamento_diario_reais',true,'numeric','em REAIS aqui; o executor converte para centavos','idem'),
('criar_conjunto_a_partir_de','conta_destino',true,'text','formato act_<id>','idem'),
('criar_conjunto_a_partir_de','status_inicial',true,'text','PAUSED por contrato de 03/08','idem'),
-- Semeado do payload do card 86b2a293 (campanha TESTE-B), executado em 31/07.
('criar_campanha','nome_novo',true,'text',null,'payload do card 86b2a293, executado com sucesso em 31/07/2026'),
('criar_campanha','objetivo',true,'text','ODAX; objetivos legados sao recusados pela Meta','idem'),
('criar_campanha','conta_destino',true,'text','formato act_<id>','idem'),
('criar_campanha','special_ad_categories',true,'text[]','FINANCIAL_PRODUCTS_SERVICES em credito','payload do card 1b69990c'),
('criar_campanha','status_inicial',true,'text','PAUSED por contrato de 03/08','idem')
on conflict do nothing;

create or replace function public.validar_pedido_contra_contrato(p_acao text, p_pedido jsonb)
returns jsonb
language plpgsql
stable
as $$
declare v_n int; v_faltando text[]; v_extras text[];
begin
  select count(*) into v_n from public.contrato_de_execucao where acao = p_acao and vigente;

  if v_n = 0 then
    return jsonb_build_object(
      'valido', false,
      'motivo','contrato_desconhecido',
      'acao', p_acao,
      'mensagem','NAO existe contrato declarado para a acao "' || p_acao || '". Isso significa que ninguem registrou quais campos o executor exige - e nao que o pedido esta errado. '
        || 'Montar o card assim seria adivinhar, e adivinhar esta lista ja falhou tres vezes neste projeto. '
        || 'Quem resolve: quem le o codigo do meta-actions declara os campos, ou um card desta acao executa com sucesso e o payload dele vira a evidencia.',
      'como_registrar','insert into contrato_de_execucao (acao, campo, obrigatorio, tipo, fonte) values (...)');
  end if;

  select array_agg(c.campo order by c.campo) into v_faltando
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.obrigatorio
     and not (p_pedido ? c.campo);

  select array_agg(k order by k) into v_extras
    from jsonb_object_keys(coalesce(p_pedido,'{}'::jsonb)) k
   where not exists (select 1 from public.contrato_de_execucao c
                      where c.acao = p_acao and c.vigente and c.campo = k);

  return jsonb_build_object(
    'valido', (v_faltando is null),
    'acao', p_acao,
    'campos_exigidos', v_n,
    'faltando', coalesce(to_jsonb(v_faltando), '[]'::jsonb),
    'nao_previstos_no_contrato', coalesce(to_jsonb(v_extras), '[]'::jsonb),
    'nota_sobre_os_extras','Campo fora do contrato NAO invalida o pedido: pode ser narrativa (justificativa, risco, reversa) ou campo que o executor aceita e ninguem registrou. Ele e listado para quem mantiver o contrato decidir, nao para bloquear.',
    'mensagem', case when v_faltando is null
      then 'Pedido tem todos os campos obrigatorios declarados para esta acao.'
      else 'Faltam campos obrigatorios: ' || array_to_string(v_faltando, ', ') || '. O card NAO deve ser emitido - ele falharia na execucao depois de gastar uma aprovacao.' end);
end;
$$;