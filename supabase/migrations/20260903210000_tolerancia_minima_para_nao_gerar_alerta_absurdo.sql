-- Tarefa nao pode ser cadastrada com tolerancia zero, e o vigia deixa de emitir "ha 0 horas".
--
-- Sintoma achado no texto do primeiro alerta gravado no padrao novo:
--
--   "Rotina do sistema parada: Foto diaria da configuracao das campanhas"  [critical]
--   "... deveria rodar uma vez por dia e nao conclui uma rodada ha 0 horas"
--   "ultima rodada boa em 03/09/2026 17:07 (tolerancia: 0h)"
--
-- Emitido as 17:31 para uma tarefa que havia rodado com sucesso as 17:07. Alerta
-- critico dizendo que a rotina esta parada ha zero hora e exatamente o tipo de saida
-- ilegivel que esta entrega existe para eliminar -- e desta vez foi o codigo novo que
-- produziu.
--
-- Causa: com `tolerancia_horas = 0`, qualquer tempo decorrido passa da tolerancia
-- (`v_horas <= 0` e falso para qualquer v_horas positivo), e a escala de gravidade
-- desanda junto -- `v_horas >= tolerancia * 4` vira `v_horas >= 0`, que e sempre
-- verdadeiro. Ou seja: tolerancia zero nao significa "vigie de perto", significa
-- "grite CRITICO sem parar". A linha ficou 0 num estado intermediario da carga do
-- catalogo; o proprio vigia resolveu o alerta na rodada seguinte, quando a tolerancia
-- ja estava em 30h. Nenhum alerta absurdo esta aberto hoje.
--
-- Duas camadas de conserto, porque uma so nao basta:
--
-- 1. O banco recusa o cadastro invalido (CHECK >= 1 e NOT NULL). Tolerancia e o que
--    separa "atrasada" de "no prazo": tarefa sem tolerancia declarada nao e vigiavel,
--    e o certo e recusar o cadastro em vez de aceitar e alertar errado depois.
--
-- 2. O vigia usa um piso defensivo de 1 hora ao ler o valor. A trava acima ja impede o
--    zero de entrar, mas o vigia e quem fala com o gestor: se algum dia o dado escapar
--    (restore, carga manual, coluna alterada), e melhor ele errar para o lado de nao
--    gritar. Alem disso a frase passa a dizer "menos de uma hora" em vez de "ha 0
--    horas", que nao e frase que alguem escreveria.

alter table public.tarefas_agendadas
  alter column tolerancia_horas set not null;

alter table public.tarefas_agendadas
  drop constraint if exists tarefas_agendadas_tolerancia_minima;

alter table public.tarefas_agendadas
  add constraint tarefas_agendadas_tolerancia_minima
  check (tolerancia_horas >= 1);

comment on column public.tarefas_agendadas.tolerancia_horas is
  'Horas sem rodada bem-sucedida antes de a tarefa ser considerada atrasada. Minimo 1: '
  'tolerancia zero nao vigia de perto, ela emite alerta critico continuamente.';

create or replace function public.vigiar_tarefas_agendadas()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_ultimo_ok timestamptz;
  v_ultima record;
  v_horas numeric;
  v_tol numeric;
  v_sev alert_severity;
  v_atrasadas int := 0;
  v_alertas int := 0;
  v_ok int := 0;
  v_company uuid;
  v_periodo text;
  v_ha text;
begin
  for v_t in select * from public.tarefas_agendadas where ativa order by tarefa loop
    v_company := coalesce(v_t.company_id, public.empresa_principal());

    -- Piso defensivo: ver o comentario da migracao. Zero nunca deve chegar aqui, mas se
    -- chegar, o vigia erra para o lado de nao gritar.
    v_tol := greatest(coalesce(v_t.tolerancia_horas, 1), 1);

    v_periodo := case v_t.periodicidade
                   when 'frequente' then 'a cada poucos minutos'
                   when 'horaria'   then 'de hora em hora'
                   when 'diaria'    then 'uma vez por dia'
                   when 'semanal'   then 'uma vez por semana'
                 end;

    select max(e.iniciado_em) into v_ultimo_ok
      from public.execucoes_agendadas e
     where e.tarefa = v_t.tarefa
       and e.desfecho in ('sucesso', 'sucesso_vazio');

    select e.desfecho, e.iniciado_em, e.mensagem_erro into v_ultima
      from public.execucoes_agendadas e
     where e.tarefa = v_t.tarefa
     order by e.iniciado_em desc
     limit 1;

    if v_ultimo_ok is null and v_t.criado_em > now() - (v_tol * interval '1 hour') then
      v_ok := v_ok + 1;
      continue;
    end if;

    v_horas := case when v_ultimo_ok is null
                    then extract(epoch from (now() - v_t.criado_em)) / 3600.0
                    else extract(epoch from (now() - v_ultimo_ok)) / 3600.0 end;

    if v_horas <= v_tol then
      v_ok := v_ok + 1;
      update public.alerts set resolved = true
       where resolved = false and chave_dedupe = 'tarefa_parada:' || v_t.tarefa;
      continue;
    end if;

    v_sev := case
               when v_horas >= v_tol * 4 then 'critical'::alert_severity
               when v_horas >= v_tol * 2 then 'high'::alert_severity
               else 'medium'::alert_severity
             end;

    -- "ha 0 horas" nao e frase que alguem escreveria.
    v_ha := case when v_horas < 1  then 'menos de uma hora'
                 when v_horas < 48 then round(v_horas)::text || ' horas'
                 else round(v_horas / 24)::text || ' dias' end;

    v_atrasadas := v_atrasadas + 1;

    perform public.emitir_alerta(
      p_company_id    => v_company,
      p_severidade    => v_sev,
      p_titulo        => 'Rotina do sistema parada: ' || v_t.titulo,
      p_o_que         => format('A rotina "%s" deveria rodar %s e nao conclui uma rodada ha %s. Ela responde: %s. Enquanto estiver parada, essa resposta esta velha e nao se deve confiar nela.',
                                v_t.titulo, v_periodo, v_ha, v_t.pergunta),
      p_onde          => 'Rotina interna do sistema (' || v_t.tarefa || ')',
      p_quanto        => case when v_ultimo_ok is null
                              then 'nenhuma rodada bem-sucedida desde o cadastro'
                              else 'ultima rodada boa em ' || to_char(v_ultimo_ok at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                                   || ' (tolerancia: ' || v_tol::int || 'h)' end
                         || case when v_ultima.desfecho = 'falha' and v_ultima.mensagem_erro is not null
                                 then '. Ultima tentativa falhou: ' || left(v_ultima.mensagem_erro, 250)
                                 else '' end,
      p_acao          => 'Abrir a tela Tarefas agendadas e reexecutar esta rotina. Se ela voltar a falhar, o problema esta na rotina, nao no agendamento.',
      p_janela        => 'esperado ' || v_periodo || ', tolerancia de ' || v_tol::int || 'h',
      p_tarefa        => v_t.tarefa,
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'tarefa_parada:' || v_t.tarefa,
      p_valor         => round(v_horas, 1));

    v_alertas := v_alertas + 1;
  end loop;

  delete from public.execucoes_agendadas where iniciado_em < now() - interval '90 days';

  return jsonb_build_object(
    'verificado_em', now(),
    'tarefas_em_dia', v_ok,
    'tarefas_atrasadas', v_atrasadas,
    'alertas_emitidos', v_alertas);
end
$function$;

revoke all on function public.vigiar_tarefas_agendadas() from public, anon, authenticated;
grant execute on function public.vigiar_tarefas_agendadas() to service_role;
