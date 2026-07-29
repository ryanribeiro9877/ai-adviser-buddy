-- PARTE 1 - EXECUCAO POR EMPRESA (bloqueante antes de ligar qualquer flag)
-- meta_execution_config era SINGLETON por desenho: check constraint travava id=1, e a linha
-- unica valia para todas as empresas. Com a COHAPM real no banco (3 contas Meta, 8 campanhas),
-- ligar master_enabled alcancaria as campanhas dela sob configuracao calibrada so para a
-- Legal. Mesma classe do bug do contasOk[0]: seguro por acidente com uma empresa, errado com
-- duas. O singleton deixa de fazer sentido - por isso o check e removido.

alter table public.meta_execution_config drop constraint if exists meta_execution_config_id_check;

alter table public.meta_execution_config
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.meta_execution_config
   set company_id = (select id from companies where name ilike '%legal%' order by created_at limit 1)
 where id = 1 and company_id is null;

create unique index if not exists uq_meta_exec_config_company
  on public.meta_execution_config (company_id);

insert into public.meta_execution_config
  (id, company_id, master_enabled, dry_run, action_flags, max_actions_per_hour,
   contas_permitidas_criacao, teto_sanidade_orcamento_diario)
select (select coalesce(max(id),0) from meta_execution_config)
         + row_number() over (order by c.created_at),
       c.id, false, true,
  jsonb_build_object('pausar_criativo',false,'escalar_criativo',false,'pausar_campanha',false,
    'alterar_orcamento',false,'replicar_template',false,'criar_campanha',false,
    'criar_conjunto_a_partir_de',false,'criar_anuncio_a_partir_de',false),
  5, '{}'::text[], 5000
  from companies c
 where not exists (select 1 from meta_execution_config m where m.company_id = c.id);

comment on column public.meta_execution_config.company_id is
  'Configuracao de execucao e POR EMPRESA. Empresa sem linha propria nao executa nada. O meta-actions v3+ deve carregar a config pela company_id do approval_request, NUNCA por id=1 - ler id=1 aplicaria a configuracao da Legal e Viver a outra empresa.';

-- PARTE 2 - VALIDADE DO CONHECIMENTO
-- O agente ja degrada no runtime (marca [VENCIDO] e avisa "nao confirmado"). Faltava avisar o
-- HUMANO. Prazos encurtados: politica financeira muda mais rapido que biblioteca de criativo.

update public.agent_knowledge set revalidar_ate = verificado_em + 30  where tema = 'compliance';
update public.agent_knowledge set revalidar_ate = verificado_em + 60  where tema in ('api','metricas','criacao');
update public.agent_knowledge set revalidar_ate = verificado_em + 180 where tema in ('otimizacao','diagnostico_especialista');
update public.agent_knowledge set revalidar_ate = verificado_em + 365 where tema in ('unidade_economica','evolucao');
update public.agent_knowledge set revalidar_ate = verificado_em + 545 where tema like 'criativo%';

create or replace function public.check_conhecimento_validade()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid; v_vencidos int; v_proximos int; v_lista text;
begin
  select id into v_company from companies where name ilike '%legal%' order by created_at limit 1;

  select count(*), string_agg(tema || ' (venceu ' || to_char(revalidar_ate,'DD/MM') || ')', ', ' order by revalidar_ate)
    into v_vencidos, v_lista
    from agent_knowledge where vigente and revalidar_ate < current_date;

  select count(*) into v_proximos from agent_knowledge
   where vigente and revalidar_ate >= current_date and revalidar_ate < current_date + 14;

  if v_vencidos > 0 and v_company is not null then
    if not exists (select 1 from alerts where company_id = v_company and resolved = false
        and title = 'Conhecimento tecnico vencido' and created_at > now() - interval '6 days') then
      insert into alerts (company_id, severity, title, description, triggered_value)
      values (v_company,
        case when v_vencidos >= 3 then 'high'::alert_severity else 'medium'::alert_severity end,
        'Conhecimento tecnico vencido',
        format('%s tema(s) da base de conhecimento passaram do prazo de revalidacao: %s. O agente ja os trata como NAO CONFIRMADOS, mas precisam ser reverificados na fonte oficial. Politica da Meta e specs de API sao os mais sensiveis - afirmar politica desatualizada em conta de credito e risco de reprovacao.',
               v_vencidos, v_lista), v_vencidos);
    end if;
  end if;

  return jsonb_build_object('verificado_em', now(), 'vencidos', v_vencidos,
    'vencendo_em_14_dias', v_proximos, 'temas_vencidos', v_lista);
end $$;

revoke all on function public.check_conhecimento_validade() from public, anon;
grant execute on function public.check_conhecimento_validade() to authenticated, service_role;

comment on function public.check_conhecimento_validade() is
  'Alerta semanal quando tema da base de conhecimento passa do revalidar_ate. O agente degrada sozinho no runtime; esta funcao avisa o humano, senao o conhecimento envelhece em silencio.';

select cron.schedule('valida-conhecimento-semanal', '25 10 * * 1',
  $$select public.check_conhecimento_validade();$$);
