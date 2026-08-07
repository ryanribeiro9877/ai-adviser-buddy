-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807183846
-- name: recusa_destino_dynamic_creative
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- DESTINO DYNAMIC CREATIVE: RECUSA NOMEADA ANTES DO CARD E ANTES DO ADCREATIVE.
-- `suportado=false` nao cabe aqui: e campo do pedido; is_dynamic_creative e estado Graph.
alter table public.ad_sets
  add column if not exists is_dynamic_creative boolean,
  add column if not exists estado_graph_observado_em timestamptz,
  add column if not exists estado_graph_fonte text;
comment on column public.ad_sets.is_dynamic_creative is 'Ultimo valor de is_dynamic_creative observado na Graph. true impede create_ad avulso; null significa estado ainda nao verificado e falha fechado antes do card.';
comment on column public.ad_sets.estado_graph_observado_em is 'Instante da observacao Graph que sustenta campos de estado do conjunto, inclusive is_dynamic_creative.';
comment on column public.ad_sets.estado_graph_fonte is 'Procedencia verificavel da observacao. Nao e valor inferido do nome do conjunto.';
create table if not exists public.contrato_de_estado_execucao (
  id uuid primary key default gen_random_uuid(), acao text not null, campo_destino text not null,
  propriedade text not null, valor_recusado boolean not null, recusa_nomeada text not null,
  mensagem_de_recusa text not null, recusa_estado_desconhecido text not null,
  mensagem_estado_desconhecido text not null, fonte text not null,
  vigente boolean not null default true, criado_em timestamptz not null default now()
);
create unique index if not exists contrato_estado_uma_regra_vigente
  on public.contrato_de_estado_execucao (acao, campo_destino, propriedade) where vigente;
alter table public.contrato_de_estado_execucao enable row level security;
drop policy if exists contrato_estado_leitura on public.contrato_de_estado_execucao;
create policy contrato_estado_leitura on public.contrato_de_estado_execucao for select to authenticated using (true);
revoke all on table public.contrato_de_estado_execucao from public, anon;
grant select on table public.contrato_de_estado_execucao to authenticated, service_role;
comment on table public.contrato_de_estado_execucao is 'Eixo separado de contrato_de_execucao.suportado: regras que recusam pelo estado observado de um objeto destino, nao pela presenca de um campo no pedido. Nomes e mensagens vivem aqui; validadores nao os digitam.';
insert into public.contrato_de_estado_execucao (
  acao,campo_destino,propriedade,valor_recusado,recusa_nomeada,mensagem_de_recusa,
  recusa_estado_desconhecido,mensagem_estado_desconhecido,fonte)
select 'criar_anuncio_a_partir_de','conjunto_destino_external_id','is_dynamic_creative',true,
  'conjunto_destino_criativo_dinamico',
  'Nao emiti o card porque o conjunto de destino esta configurado para Criativo Dinamico. Esse tipo de conjunto nao aceita a criacao de um anuncio avulso. Escolha um conjunto com Criativo Dinamico desativado ou crie um novo conjunto a partir do molde; as replicas criadas pelo sistema nascem com essa opcao desativada.',
  'estado_conjunto_destino_nao_verificado',
  'Nao emiti o card porque ainda nao tenho uma leitura confiavel do conjunto de destino que confirme se ele aceita um anuncio avulso. Atualize os dados da conta ou escolha um conjunto cujo estado ja tenha sido verificado.',
  'Graph GET /{conjunto_destino}?fields=is_dynamic_creative; executor meta-actions v5.2'
where not exists (select 1 from public.contrato_de_estado_execucao where acao='criar_anuncio_a_partir_de' and campo_destino='conjunto_destino_external_id' and propriedade='is_dynamic_creative' and vigente);
update public.ad_sets set is_dynamic_creative=true, estado_graph_observado_em='2026-08-07 18:20:00+00', estado_graph_fonte='Graph fields=is_dynamic_creative; medicao 07/08/2026'
 where company_id='ded20b38-f42e-4c71-800c-31b97ea48bcf' and account_id='3302001729967572'
 and external_id in ('120251373799340191','120253805954390191','120253542040290191','120253897605020191');
update public.ad_sets set is_dynamic_creative=false, estado_graph_observado_em='2026-08-07 18:20:00+00', estado_graph_fonte='Graph fields=is_dynamic_creative; medicao 07/08/2026'
 where company_id='ded20b38-f42e-4c71-800c-31b97ea48bcf' and account_id='3302001729967572'
 and external_id in ('120254208284780191','120253389922700191');
create or replace function public.avaliar_estado_destino_execucao(p_acao text,p_pedido jsonb,p_company_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_regra public.contrato_de_estado_execucao%rowtype; v_destino text; v_conta text; v_estado boolean; v_encontrado boolean:=false;
begin
 select * into v_regra from public.contrato_de_estado_execucao where acao=p_acao and vigente order by criado_em desc limit 1;
 if not found then return jsonb_build_object('valido',true,'avaliado',false,'motivo','acao_sem_regra_de_estado'); end if;
 v_destino:=coalesce(nullif(btrim(coalesce(p_pedido->>v_regra.campo_destino,'')),''),nullif(btrim(coalesce(p_pedido->>'conjunto_destino','')),''));
 if v_destino is null then return jsonb_build_object('valido',true,'avaliado',false,'motivo','destino_ausente'); end if;
 v_conta:=regexp_replace(nullif(btrim(coalesce(p_pedido->>'conta_destino','')),''),'^act_','');
 select a.is_dynamic_creative,true into v_estado,v_encontrado from public.ad_sets a
  where a.external_id=v_destino and (p_company_id is null or a.company_id=p_company_id)
    and (v_conta is null or a.account_id=v_conta)
  order by a.estado_graph_observado_em desc nulls last limit 1;
 if not v_encontrado or v_estado is null then
  return jsonb_build_object('valido',false,'avaliado',true,'propriedade',v_regra.propriedade,'estado_observado',null,'recusa',v_regra.recusa_estado_desconhecido,'mensagem',v_regra.mensagem_estado_desconhecido);
 end if;
 if v_estado=v_regra.valor_recusado then
  return jsonb_build_object('valido',false,'avaliado',true,'propriedade',v_regra.propriedade,'estado_observado',v_estado,'recusa',v_regra.recusa_nomeada,'mensagem',v_regra.mensagem_de_recusa);
 end if;
 return jsonb_build_object('valido',true,'avaliado',true,'propriedade',v_regra.propriedade,'estado_observado',v_estado,'mensagem','O conjunto de destino foi verificado e aceita anuncio avulso.');
end; $$;
revoke all on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) from public,anon;
grant execute on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) to authenticated,service_role;
comment on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) is 'Avalia regras declaradas de estado do destino usando o ultimo valor Graph espelhado. Estado desconhecido falha fechado. Nomes e mensagens vem de contrato_de_estado_execucao.';
alter function public.validar_pedido_contra_contrato(text,jsonb) rename to validar_pedido_contra_contrato_sem_estado_destino;
create function public.validar_pedido_contra_contrato(p_acao text,p_pedido jsonb) returns jsonb language plpgsql stable set search_path=public as $$
declare v_base jsonb; v_estado jsonb;
begin
 v_base:=public.validar_pedido_contra_contrato_sem_estado_destino(p_acao,p_pedido);
 if coalesce((v_base->>'valido')::boolean,false) is not true then return v_base; end if;
 v_estado:=public.avaliar_estado_destino_execucao(p_acao,p_pedido,null);
 if coalesce((v_estado->>'valido')::boolean,true) is not true then
  return v_base||jsonb_build_object('valido',false,'recusa',v_estado->>'recusa','estado_destino',v_estado,'mensagem',(v_estado->>'mensagem')||' O card NAO deve ser emitido.');
 end if;
 return v_base||jsonb_build_object('estado_destino',v_estado);
end; $$;
revoke all on function public.validar_pedido_contra_contrato(text,jsonb) from public,anon;
grant execute on function public.validar_pedido_contra_contrato(text,jsonb) to authenticated,service_role;
comment on function public.validar_pedido_contra_contrato(text,jsonb) is 'Valida primeiro os campos pelo contrato existente e depois o estado do objeto destino. Dynamic Creative recusa por nome; estado desconhecido falha fechado. A regra e as mensagens nao estao escritas nesta funcao.';
alter function public.pedido_de_anuncio_completo(uuid,jsonb) rename to pedido_de_anuncio_completo_sem_estado_destino;
create function public.pedido_de_anuncio_completo(p_company_id uuid,p_pedido jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_base jsonb; v_estado jsonb;
begin
 v_base:=public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id,p_pedido);
 if coalesce((v_base->>'completo')::boolean,false) is not true then return v_base; end if;
 v_estado:=public.avaliar_estado_destino_execucao('criar_anuncio_a_partir_de',p_pedido,p_company_id);
 if coalesce((v_estado->>'valido')::boolean,true) is not true then
  return v_base||jsonb_build_object('completo',false,'recusa',v_estado->>'recusa','estado_destino',v_estado,'faltando','[]'::jsonb,'mensagem_para_o_gestor',v_estado->>'mensagem');
 end if;
 return v_base||jsonb_build_object('estado_destino',v_estado);
end; $$;
revoke all on function public.pedido_de_anuncio_completo(uuid,jsonb) from public,anon;
grant execute on function public.pedido_de_anuncio_completo(uuid,jsonb) to authenticated,service_role;
comment on function public.pedido_de_anuncio_completo(uuid,jsonb) is 'Gate antes do card. Mantem todos os gates operacionais existentes e acrescenta estado do conjunto destino: Dynamic Creative recusa com o mesmo nome do executor; estado Graph desconhecido falha fechado.';
update public.perguntas_ouro set vigente=false where conjunto='v2' and codigo='PO-17' and vigente;
insert into public.perguntas_ouro(conjunto,codigo,versao,dimensao,pergunta,expectativa_verificavel,como_verificar,fonte_da_verdade,protege_regra,vigente) values (
 'v2','PO-17',3,'caminho_de_execucao',
 'Para o mesmo pedido de criar_anuncio_a_partir_de, os dois validadores continuam fechando os eixos de campo e estado? Em particular, o agente recusa um conjunto de destino com Criativo Dinamico pelo motivo real antes de emitir o card, sem depender de conhecer um codigo de erro da plataforma?',
 'MATRIZ COMPLETA: nas rotas peca_nova e replicacao_pura, os 4 obrigatorios presentes aceitam quando o destino tem is_dynamic_creative=false; removendo cada obrigatorio, os dois recusam. Carrossel e foto recusam pelo mesmo nome nos dois lados. Peca em revisao mantem apenas a assimetria segura completo=false/valido=true. Destino conhecido com is_dynamic_creative=true devolve completo=false e valido=false, ambos com recusa conjunto_destino_criativo_dinamico e mensagem que explica que Criativo Dinamico nao aceita anuncio avulso e orienta escolher destino com a opcao desativada ou criar replica. A resposta nao precisa conhecer nem citar subcode. Estado desconhecido falha fechado. Em nenhum caso pode existir completo=true com valido=false.',
 'Use um destino Graph conhecido false (120254208284780191), um conhecido true (120251373799340191) e um ID desconhecido. Rode pedido_de_anuncio_completo(company,pedido) e validar_pedido_contra_contrato(acao,pedido) sobre exatamente o mesmo JSON. Depois cubra peca nova, replicacao pura, remocao individual dos 4 obrigatorios, carrossel, foto e peca bloqueada. Classifique completo=true/valido=false como falha imediata.',
 'pedido_de_anuncio_completo + validar_pedido_contra_contrato + contrato_de_execucao + contrato_de_estado_execucao + ad_sets.is_dynamic_creative + Graph fields=is_dynamic_creative + meta-actions montarCriacao','{13}',true);
do $$ begin
 if (select count(*) from public.ad_sets where company_id='ded20b38-f42e-4c71-800c-31b97ea48bcf' and external_id in ('120251373799340191','120253805954390191','120253542040290191','120253897605020191') and is_dynamic_creative is true)<>4 then raise exception 'nao foi possivel registrar os quatro destinos Dynamic Creative medidos'; end if;
 if not exists(select 1 from public.perguntas_ouro where conjunto='v2' and codigo='PO-17' and versao=3 and vigente) then raise exception 'PO-17 v3 nao ficou vigente'; end if;
end $$;
