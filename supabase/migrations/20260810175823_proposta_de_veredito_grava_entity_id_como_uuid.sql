-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810175823
-- name: proposta_de_veredito_grava_entity_id_como_uuid
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- entity_id de approval_requests e uuid, nao text. A versao anterior fazia rev.id::text e
-- estourava 42804 na emissao do card. Pego pela prova sintetica antes de qualquer uso real.
create or replace function public.registrar_veredito_peca_em_revisao(
  p_company_id uuid,
  p_drive_file_id text,
  p_veredito text,
  p_veredito_por text default null,
  p_nota text default null,
  p_solicitado_por uuid default null,
  p_conversation_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_drive text := nullif(trim(coalesce(p_drive_file_id,'')),'');
  v_ver text := nullif(trim(coalesce(p_veredito,'')),'');
  v_nota text := nullif(trim(coalesce(p_nota,'')),'');
  v_quem uuid := coalesce(auth.uid(), p_solicitado_por);
  rev public.pecas_em_revisao%rowtype;
  v_pendente uuid;
  v_card uuid;
  v_expira timestamptz;
  v_efeito text;
begin
  if p_company_id is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_company_id';
  end if;
  if v_drive is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_drive_file_id';
  end if;
  if v_ver is null or v_ver not in ('liberado_como_esta','ajustar_peca','nao_usar') then
    raise exception 'veredito invalido: use liberado_como_esta | ajustar_peca | nao_usar';
  end if;
  if v_quem is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_solicitado_por (o usuario em nome de quem a proposta e feita). Proposta sem solicitante nao e proposta.';
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and veredito is null
   order by aberto_em desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nenhuma_revisao_aberta',
      'mensagem', 'Nao ha revisao aberta (veredito nulo) para esta peca nesta empresa. Nao invente veredito nem reabra por fora.');
  end if;

  select id into v_pendente
    from public.approval_requests
   where company_id = p_company_id
     and action = 'registrar_veredito_peca'
     and status = 'pending'
     and payload->>'peca_id' = rev.id::text
   limit 1;

  if v_pendente is not null then
    return jsonb_build_object('ok', false, 'erro', 'proposta_ja_pendente', 'card_id', v_pendente,
      'mensagem', 'Ja existe uma proposta de veredito aguardando decisao para esta peca. Nao emiti outra. A peca segue impedida ate o administrador decidir.');
  end if;

  v_efeito := case when v_ver = 'liberado_como_esta'
    then 'Aprovar LIBERA a peca para virar anuncio.'
    else 'Aprovar MANTEM a peca impedida para anuncio.' end;

  insert into public.approval_requests(
    company_id, requested_by, conversation_id, entity_type, entity_id, action, summary, payload, status)
  values (
    p_company_id, v_quem, p_conversation_id, 'peca_em_revisao'::public.approval_entity, rev.id,
    'registrar_veredito_peca',
    'Veredito de compliance na peca "' || coalesce(rev.nome, v_drive) || '": ' || v_ver
      || case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end,
    jsonb_build_object(
      'peca_id', rev.id, 'drive_file_id', rev.drive_file_id, 'nome', rev.nome,
      'regra_code', rev.regra_code, 'motivo_da_revisao', rev.motivo,
      'veredito', v_ver, 'nota', v_nota,
      'autor_sugerido', nullif(trim(coalesce(p_veredito_por,'')),''),
      'proposto_por', 'registrar_veredito_peca_em_revisao',
      'efeito_se_aprovado', v_efeito,
      'aviso', 'A assinatura do veredito NAO vem deste payload: quem assina e o administrador que aprovar o card, resolvido por auth.users. autor_sugerido e apenas registro de quem o agente disse que pediu.'),
    'pending')
  returning id, expires_at into v_card, v_expira;

  return jsonb_build_object(
    'ok', true,
    'estado', 'pendente_de_aprovacao',
    'card_id', v_card,
    'expira_em', v_expira,
    'peca', rev.nome,
    'veredito_proposto', v_ver,
    'bloqueia_uso_agora', rev.bloqueia_uso,
    'mensagem', 'NAO registrei veredito: emiti um card de aprovacao. A peca CONTINUA impedida e nada muda ate um administrador aprovar na tela. ' || v_efeito || ' Voce nao pode aprovar o proprio pedido, e a assinatura sera a de quem aprovar.');
end;
$fn$;
