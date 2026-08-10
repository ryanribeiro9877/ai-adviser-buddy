-- Liga as tres action_flags pedidas pelo gestor para a Legal e Viver.
-- As tres ja sao automatizadas em pode_executar_acao; so a trava por empresa estava fechada.
-- Demais empresas permanecem com as flags false: este pedido cobre so a conta operacional.

update public.meta_execution_config
   set action_flags = action_flags
     || jsonb_build_object(
          'alterar_orcamento', true,
          'pausar_campanha', true,
          'pausar_criativo', true
        )
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

do $$
declare
  v_flags jsonb;
begin
  select action_flags into v_flags
    from public.meta_execution_config
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

  if v_flags is null then
    raise exception 'Legal e Viver sem meta_execution_config';
  end if;

  if coalesce((v_flags->>'alterar_orcamento')::boolean, false) is not true
     or coalesce((v_flags->>'pausar_campanha')::boolean, false) is not true
     or coalesce((v_flags->>'pausar_criativo')::boolean, false) is not true then
    raise exception 'flags nao ligaram: %', v_flags;
  end if;
end $$;
