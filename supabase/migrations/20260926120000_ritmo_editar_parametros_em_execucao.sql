-- Edicao dos parametros de uma forca-tarefa ja em execucao (26/09/2026)
--
-- POR QUE: o gestor so podia encerrar. Prazo, metrica, sonho, extra e
-- dissertacao precisavam mudar sem abrir outra missao nem trocar a campanha.
--
-- O QUE NAO MEXE: concessao, status, baseline congelado, campanha, portao
-- de escrita. O teto da janela e recalculado: baseline × dias do prazo + extra.

create or replace function public.atualizar_parametros_ritmo_missao(
  p_id uuid,
  p_periodo_inicio date,
  p_periodo_fim date,
  p_metrica text,
  p_dissertacao text,
  p_sonho numeric,
  p_extra numeric
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m public.ritmo_missoes;
  v_dias integer;
  v_teto numeric;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;

  select * into v_m from public.ritmo_missoes where id = p_id for update;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;

  if auth.uid() is null
     or not public.has_role(auth.uid(), 'admin'::app_role)
     or not public.is_company_member(v_m.company_id, auth.uid()) then
    raise exception 'somente administrador da empresa edita forca-tarefa';
  end if;

  if p_dissertacao is null or length(btrim(p_dissertacao)) = 0 then
    raise exception 'dissertacao obrigatoria';
  end if;
  if p_periodo_inicio is null or p_periodo_fim is null
     or p_periodo_fim < p_periodo_inicio
     or (p_periodo_fim - p_periodo_inicio) > 89 then
    raise exception 'prazo invalido: no maximo 90 dias corridos';
  end if;
  if p_metrica not in (
       'conversas','cliques_no_link','formularios','alcance','impressoes','ctr','ctr_link'
     ) then
    raise exception 'metrica desconhecida';
  end if;
  if p_sonho is not null and p_sonho <= 0 then
    raise exception 'sonho invalido';
  end if;
  if p_extra is not null and p_extra < 0 then
    raise exception 'extra invalido';
  end if;

  if v_m.status is distinct from 'em_execucao' then
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;

  v_dias := (p_periodo_fim - p_periodo_inicio) + 1;
  v_teto := coalesce(v_m.baseline_gasto_diario, 0) * v_dias + coalesce(p_extra, 0);
  if v_teto < 0 then
    v_teto := 0;
  end if;

  update public.ritmo_missoes
     set periodo_inicio = p_periodo_inicio,
         periodo_fim = p_periodo_fim,
         metrica = p_metrica,
         dissertacao = btrim(p_dissertacao),
         sonho = p_sonho,
         extra_investimento = coalesce(p_extra, 0),
         teto_gasto_janela = v_teto,
         plano_json = case
           when plano_json is not null and jsonb_typeof(plano_json) = 'object'
           then jsonb_set(plano_json, '{teto_janela}', to_jsonb(v_teto), true)
           else plano_json
         end,
         atualizado_em = now()
   where id = p_id
     and status = 'em_execucao';

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;

  return jsonb_build_object('ok', true, 'teto_gasto_janela', v_teto);
end;
$$;

comment on function public.atualizar_parametros_ritmo_missao(uuid, date, date, text, text, numeric, numeric) is
  'Admin ajusta prazo, metrica, sonho, extra e dissertacao de uma missao em execucao. Campanha, concessao e baseline ficam. O teto da janela e baseline vezes os dias do prazo, mais o extra.';

revoke all on function public.atualizar_parametros_ritmo_missao(uuid, date, date, text, text, numeric, numeric) from public, anon;
grant execute on function public.atualizar_parametros_ritmo_missao(uuid, date, date, text, text, numeric, numeric) to authenticated, service_role;
