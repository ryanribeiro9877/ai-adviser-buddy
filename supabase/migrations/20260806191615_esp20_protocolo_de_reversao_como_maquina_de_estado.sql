-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806191615
-- name: esp20_protocolo_de_reversao_como_maquina_de_estado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-20 · protocolo de reversao de estagnacao, como MAQUINA DE ESTADO.
--
-- POR QUE MAQUINA DE ESTADO E NAO DESCRICAO: descrever a sequencia nao acrescenta nada - ela esta
-- no contrato e o agente pode ler. O que o protocolo previne e uma ORDEM ERRADA: pausar o antigo
-- antes de o novo estar entregando deixa a conta sem entrega no intervalo. Isso so se previne com
-- algo que RECUSA o passo fora de ordem.
--
-- A SEQUENCIA, do CONTRA_2 Parte III:
--   proposta -> novo_criado_pausado -> novo_ativado -> entrega_confirmada -> origem_pausada -> concluida
-- Recriar do zero joga o objeto em leilao NOVO, e e isso que reverte a estagnacao. Provado na
-- propria conta em julho: um conjunto de reversao saiu de R$ 2,17 para R$ 1,36.
--
-- O PASSO QUE E MEDIDO E NAO AFIRMADO: entrega_confirmada exige gasto REAL do conjunto novo em
-- ad_metric_snapshots. Ninguem "confirma" entrega dizendo que confirmou. Sem gasto medido a
-- transicao e recusada, e essa e a trava que sustenta todo o resto - porque e ela que autoriza
-- pausar o original.
--
-- SO A ARVORE ABRE UMA REVERSAO: iniciar_reversao consulta decidir_sobre_conjunto e recusa se a
-- decisao nao for pausar_e_criar_reversao. Reversao aberta por vontade e reversao sem diagnostico.
--
-- CAMINHO DE ABORTO EXISTE de proposito: reversao que da errado precisa fechar. Sem saida, alguem
-- fecha na mao e a maquina perde a serventia.

create table if not exists public.reversoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  adset_origem text not null,
  adset_novo text,
  estado text not null default 'proposta',
  motivo_da_abertura text not null,
  cpl_origem_na_abertura numeric,
  aberta_em timestamptz not null default now(),
  novo_criado_em timestamptz,
  novo_ativado_em timestamptz,
  entrega_confirmada_em timestamptz,
  origem_pausada_em timestamptz,
  concluida_em timestamptz,
  abortada_em timestamptz,
  motivo_do_aborto text,
  historico jsonb not null default '[]'::jsonb,
  constraint reversoes_estado_valido check (estado in
    ('proposta','novo_criado_pausado','novo_ativado','entrega_confirmada','origem_pausada','concluida','abortada')),
  constraint reversoes_uma_aberta_por_origem unique (company_id, adset_origem, estado)
);

comment on table public.reversoes is
  'ESP-20: maquina de estado do protocolo de reversao. A ordem e obrigatoria e entrega_confirmada e MEDIDA em ad_metric_snapshots, nao afirmada. Pausar a origem sem entrega confirmada do novo e o erro que esta tabela existe para impedir.';

alter table public.reversoes enable row level security;
drop policy if exists reversoes_leitura on public.reversoes;
create policy reversoes_leitura on public.reversoes for select to authenticated
  using (public.is_company_member(company_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

create or replace function public.iniciar_reversao(p_company_id uuid, p_adset_origem text)
returns jsonb
language plpgsql
volatile
as $$
declare v_arvore jsonb; v_decisao text; v_id uuid; v_aberta uuid;
begin
  if p_company_id is null or p_adset_origem is null then
    raise exception 'iniciar_reversao exige empresa e conjunto de origem';
  end if;

  select id into v_aberta from public.reversoes
   where company_id=p_company_id and adset_origem=p_adset_origem
     and estado not in ('concluida','abortada') limit 1;
  if v_aberta is not null then
    return jsonb_build_object('aberta', false, 'motivo','ja_existe_reversao_em_andamento',
      'reversao_id', v_aberta,
      'mensagem_para_o_gestor','Ja existe uma reversao em andamento para este conjunto. Duas reversoes ao mesmo tempo sobre a mesma origem produzem dois conjuntos novos e ninguem sabe qual substitui qual.');
  end if;

  v_arvore := public.decidir_sobre_conjunto(p_company_id, p_adset_origem);
  v_decisao := v_arvore->>'decisao';

  if v_decisao <> 'pausar_e_criar_reversao' then
    return jsonb_build_object('aberta', false, 'motivo','arvore_nao_indica_reversao',
      'decisao_da_arvore', v_decisao,
      'porque_a_arvore_disse_isso', v_arvore->>'porque',
      'mensagem_para_o_gestor','A arvore de decisao nao indicou reversao para este conjunto - ela disse "' || v_decisao || '". Abrir reversao sem diagnostico e recriar por vontade. Se a leitura estiver errada, corrija a leitura, nao contorne a arvore.');
  end if;

  insert into public.reversoes (company_id, adset_origem, motivo_da_abertura, cpl_origem_na_abertura, historico)
  values (p_company_id, p_adset_origem, v_arvore->>'porque',
          (v_arvore->'numeros'->>'custo_por_formulario_7d')::numeric,
          jsonb_build_array(jsonb_build_object('em', now(), 'estado','proposta','evidencia', v_arvore->'numeros')))
  returning id into v_id;

  return jsonb_build_object('aberta', true, 'reversao_id', v_id, 'estado','proposta',
    'proximo_passo','Criar o conjunto NOVO, pausado, e registrar com avancar_reversao(id, ''novo_criado_pausado'', <external_id do novo>).',
    'lembrete','A ordem e obrigatoria. O original NAO se pausa antes de o novo estar comprovadamente entregando.');
end;
$$;

create or replace function public.avancar_reversao(
  p_reversao_id uuid, p_novo_estado text, p_adset_novo text default null, p_motivo text default null)
returns jsonb
language plpgsql
volatile
as $$
declare
  r record; v_esperado text; v_gasto numeric; v_impressoes bigint;
begin
  select * into r from public.reversoes where id = p_reversao_id;
  if r is null then
    raise exception 'reversao % nao existe', p_reversao_id;
  end if;

  if r.estado in ('concluida','abortada') then
    return jsonb_build_object('avancou', false, 'motivo','reversao_encerrada', 'estado', r.estado);
  end if;

  if p_novo_estado = 'abortada' then
    update public.reversoes
       set estado='abortada', abortada_em=now(),
           motivo_do_aborto = coalesce(p_motivo,'nao declarado'),
           historico = historico || jsonb_build_object('em',now(),'estado','abortada','motivo',coalesce(p_motivo,'nao declarado'))
     where id = p_reversao_id;
    return jsonb_build_object('avancou', true, 'estado','abortada',
      'nota','Reversao abortada. O conjunto de origem NAO foi pausado por esta reversao - se ele precisa de acao, ela volta para a arvore.');
  end if;

  v_esperado := case r.estado
    when 'proposta' then 'novo_criado_pausado'
    when 'novo_criado_pausado' then 'novo_ativado'
    when 'novo_ativado' then 'entrega_confirmada'
    when 'entrega_confirmada' then 'origem_pausada'
    when 'origem_pausada' then 'concluida' end;

  if p_novo_estado <> v_esperado then
    return jsonb_build_object('avancou', false, 'motivo','passo_fora_de_ordem',
      'estado_atual', r.estado, 'unico_proximo_permitido', v_esperado, 'pedido', p_novo_estado,
      'mensagem_para_o_gestor','Passo fora de ordem RECUSADO. Do estado "' || r.estado || '" o unico proximo e "' || v_esperado
        || '". A ordem existe porque pausar a origem antes de o novo entregar deixa a conta sem entrega no intervalo.');
  end if;

  if p_novo_estado = 'novo_criado_pausado' then
    if p_adset_novo is null then
      return jsonb_build_object('avancou', false, 'motivo','falta_o_conjunto_novo',
        'mensagem_para_o_gestor','Informe o external_id do conjunto novo. Sem ele eu nao tenho o que medir depois, e a confirmacao de entrega ficaria sem objeto.');
    end if;
    update public.reversoes set estado=p_novo_estado, adset_novo=p_adset_novo, novo_criado_em=now(),
      historico = historico || jsonb_build_object('em',now(),'estado',p_novo_estado,'adset_novo',p_adset_novo)
     where id=p_reversao_id;

  elsif p_novo_estado = 'novo_ativado' then
    update public.reversoes set estado=p_novo_estado, novo_ativado_em=now(),
      historico = historico || jsonb_build_object('em',now(),'estado',p_novo_estado)
     where id=p_reversao_id;

  elsif p_novo_estado = 'entrega_confirmada' then
    -- ESTE E O PASSO MEDIDO. Nao se confirma entrega dizendo que confirmou.
    select coalesce(sum(s.spend),0), coalesce(sum(s.impressions),0) into v_gasto, v_impressoes
      from public.ad_metric_snapshots s join public.ads a on a.external_id = s.ad_external_id
     where a.adset_external_id = r.adset_novo and s.company_id = r.company_id
       and s.snapshot_date >= r.novo_ativado_em::date;

    if coalesce(v_gasto,0) <= 0 or coalesce(v_impressoes,0) <= 0 then
      return jsonb_build_object('avancou', false, 'motivo','entrega_nao_medida',
        'conjunto_novo', r.adset_novo,
        'gasto_medido', round(coalesce(v_gasto,0)::numeric,2), 'impressoes_medidas', coalesce(v_impressoes,0),
        'mensagem_para_o_gestor','RECUSADO: nao ha gasto nem impressao medidos para o conjunto novo desde a ativacao. Entrega se MEDE, nao se declara - e e essa medicao que autoriza pausar o original. Aguardar a coleta do proximo dia e tentar de novo.');
    end if;

    update public.reversoes set estado=p_novo_estado, entrega_confirmada_em=now(),
      historico = historico || jsonb_build_object('em',now(),'estado',p_novo_estado,
        'gasto_medido',round(v_gasto::numeric,2),'impressoes_medidas',v_impressoes)
     where id=p_reversao_id;

  elsif p_novo_estado = 'origem_pausada' then
    update public.reversoes set estado=p_novo_estado, origem_pausada_em=now(),
      historico = historico || jsonb_build_object('em',now(),'estado',p_novo_estado)
     where id=p_reversao_id;

  elsif p_novo_estado = 'concluida' then
    update public.reversoes set estado=p_novo_estado, concluida_em=now(),
      historico = historico || jsonb_build_object('em',now(),'estado',p_novo_estado)
     where id=p_reversao_id;
  end if;

  return jsonb_build_object('avancou', true, 'estado', p_novo_estado,
    'proximo_passo', case p_novo_estado
      when 'novo_criado_pausado' then 'Ativar o conjunto novo no Gerenciador e registrar novo_ativado.'
      when 'novo_ativado' then 'Aguardar a coleta. entrega_confirmada exige gasto e impressao MEDIDOS - nao adianta pedir antes.'
      when 'entrega_confirmada' then 'AGORA sim: pausar o conjunto de origem e registrar origem_pausada.'
      when 'origem_pausada' then 'Concluir.'
      else null end);
end;
$$;