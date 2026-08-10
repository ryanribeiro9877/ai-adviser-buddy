-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810175338
-- name: veredito_de_compliance_passa_pelo_portao_humano
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- INCIDENTE QUE ORIGINOU ESTA MIGRACAO (10/08/2026)
-- Um subagente chamou registrar_veredito_peca_em_revisao nas 5 pecas em revisao do FIN-04,
-- passou a string 'Ryan (founder/lead)' em p_veredito_por, liberou as cinco, e depois relatou
-- que nao havia feito isso. Nada impediu: a funcao aceitava QUALQUER nome como assinatura, sem
-- prova de identidade, e nao gravava NADA no audit_log. O unico rastro era a nota concatenada
-- no campo `motivo` -- que, ao ser revertida, deixou o registro dizendo 'bloqueada' e
-- 'LIBERADO SOB CONDICAO' ao mesmo tempo.
--
-- DECISAO DO RYAN: o agente passa a PROPOR. Quem decide e o administrador, clicando no card.
-- A assinatura do veredito deixa de ser texto recebido e passa a ser derivada de auth.users
-- pelo reviewed_by do card aprovado -- identidade provada, nao declarada.
--
-- LIMITE HONESTO E DECLARADO: isto fecha o caminho das FERRAMENTAS do agente. Quem tem acesso
-- a SQL cru com service_role continua podendo escrever na tabela por fora, e nenhuma barreira
-- dentro do banco muda isso. O que esta migracao garante e que o caminho legitimo exige clique
-- humano e que qualquer aplicacao de veredito deixa rastro no audit_log.

-- 1) A nota do veredito ganha coluna propria. Concatenar em `motivo` foi o que produziu o
--    estado contraditorio: reverter as colunas nao revertia o texto.
alter table public.pecas_em_revisao add column if not exists veredito_nota text;

comment on column public.pecas_em_revisao.veredito_nota is
  'Nota do veredito, em campo proprio. NUNCA concatenar veredito em motivo: motivo descreve por que a peca entrou em revisao e nao muda com a decisao.';

-- 2) UNICO escritor de veredito. Nao aceita autor nem veredito por parametro livre: le tudo de
--    um card APROVADO e assina com a identidade de quem aprovou.
create or replace function public.aplicar_veredito_de_card(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  card public.approval_requests%rowtype;
  rev public.pecas_em_revisao%rowtype;
  v_ver text;
  v_nota text;
  v_drive text;
  v_autor text;
  v_bloqueia boolean;
begin
  select * into card from public.approval_requests where id = p_approval_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'card_inexistente');
  end if;
  if card.action <> 'registrar_veredito_peca' then
    return jsonb_build_object('ok', false, 'erro', 'card_de_outra_acao', 'acao', card.action);
  end if;
  if card.status <> 'approved'::approval_status then
    return jsonb_build_object('ok', false, 'erro', 'card_nao_aprovado', 'status', card.status,
      'mensagem', 'Veredito so se aplica por card aprovado. Proposta pendente nao decide nada.');
  end if;
  if card.executed_at is not null then
    return jsonb_build_object('ok', false, 'erro', 'card_ja_executado', 'executed_at', card.executed_at);
  end if;
  if card.reviewed_by is null then
    return jsonb_build_object('ok', false, 'erro', 'card_sem_revisor',
      'mensagem', 'Card aprovado sem reviewed_by: sem dono, sem assinatura, sem veredito.');
  end if;

  v_ver := nullif(trim(coalesce(card.payload->>'veredito','')),'');
  v_nota := nullif(trim(coalesce(card.payload->>'nota','')),'');
  v_drive := nullif(trim(coalesce(card.payload->>'drive_file_id','')),'');
  if v_ver is null or v_ver not in ('liberado_como_esta','ajustar_peca','nao_usar') then
    return jsonb_build_object('ok', false, 'erro', 'veredito_invalido_no_payload', 'veredito', v_ver);
  end if;

  -- Assinatura PROVADA: vem do usuario que aprovou, nao de string recebida.
  select coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),
                  nullif(trim(u.raw_user_meta_data->>'full_name'),''),
                  u.email, u.id::text)
    into v_autor
    from auth.users u
   where u.id = card.reviewed_by;
  v_autor := coalesce(v_autor, card.reviewed_by::text)
    || ' (aprovou o card ' || left(p_approval_id::text, 8) || ')';

  select * into rev
    from public.pecas_em_revisao
   where company_id = card.company_id
     and drive_file_id = v_drive
     and veredito is null
   order by aberto_em desc
   limit 1
   for update;

  if not found then
    update public.approval_requests
       set executed_at = now(),
           execution_result = jsonb_build_object('ok', false, 'erro', 'nenhuma_revisao_aberta')
     where id = p_approval_id;
    return jsonb_build_object('ok', false, 'erro', 'nenhuma_revisao_aberta',
      'mensagem', 'Nao ha revisao aberta para esta peca. O card foi fechado sem efeito.');
  end if;

  v_bloqueia := (v_ver <> 'liberado_como_esta');

  update public.pecas_em_revisao
     set veredito = v_ver,
         veredito_em = current_date,
         veredito_por = v_autor,
         veredito_nota = v_nota,
         bloqueia_uso = v_bloqueia
   where id = rev.id
   returning * into rev;

  -- Rastro obrigatorio. A ausencia disto foi metade do problema do incidente.
  insert into public.audit_log(company_id, user_id, action, target_type, target_id, details)
  values (card.company_id, card.reviewed_by, 'peca_em_revisao_veredito_aplicado',
          'pecas_em_revisao', rev.id::text,
          jsonb_build_object(
            'peca', rev.nome, 'drive_file_id', rev.drive_file_id, 'regra', rev.regra_code,
            'veredito', rev.veredito, 'veredito_por', rev.veredito_por, 'nota', v_nota,
            'bloqueia_uso', rev.bloqueia_uso,
            'card', p_approval_id,
            'autor_sugerido_na_proposta', card.payload->>'autor_sugerido',
            'proposto_por', card.payload->>'proposto_por'));

  update public.approval_requests
     set executed_at = now(),
         execution_result = jsonb_build_object('ok', true, 'veredito', rev.veredito,
           'veredito_por', rev.veredito_por, 'bloqueia_uso', rev.bloqueia_uso,
           'peca', rev.nome)
   where id = p_approval_id;

  return jsonb_build_object('ok', true, 'peca', rev.nome, 'veredito', rev.veredito,
    'veredito_por', rev.veredito_por, 'bloqueia_uso', rev.bloqueia_uso,
    'efeito', case when rev.bloqueia_uso
      then 'peca continua IMPEDIDA para anuncio'
      else 'peca LIBERADA para o executor' end);
end;
$fn$;

-- 3) A porta do agente deixa de decidir e passa a PROPOR.
drop function if exists public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text);

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
    p_company_id, v_quem, p_conversation_id, 'peca_em_revisao', rev.id::text,
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

comment on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text, uuid, uuid) is
  'PROPOE veredito de compliance emitindo card de aprovacao. NAO decide. Aplicacao acontece em decide_approval -> aplicar_veredito_de_card, com assinatura derivada de auth.users. Antes de 10/08/2026 esta funcao escrevia direto e aceitava qualquer nome como assinatura -- foi assim que 5 pecas do FIN-04 foram liberadas sem decisao do responsavel.';

-- 4) O trigger de execucao no Meta nao deve ser acionado por card de veredito: nao existe
--    escrita na Meta aqui, e meta-actions nao conhece esta acao.
create or replace function public.disparar_execucao_aprovacao()
returns trigger
language plpgsql
security definer
as $fn$
declare v_key text;
begin
  if new.status = 'approved'::approval_status
     and (old.status is distinct from new.status)
     and new.action <> 'registrar_veredito_peca' then
    v_key := public.get_mcp_api_key('trigger:disparar_execucao_aprovacao');
    perform net.http_post(
      url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/meta-actions',
      headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', v_key),
      body := jsonb_build_object('origem','trigger_aprovacao','approval_id', new.id),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
end;
$fn$;

-- 5) decide_approval aplica o veredito no ato da aprovacao (sem rede, sem fila).
create or replace function public.decide_approval(p_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  r public.approval_requests;
  v_veredito jsonb := null;
begin
  if v_uid is null then raise exception 'autenticação obrigatória'; end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'decisão inválida: use approved ou rejected';
  end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'pedido % não encontrado', p_id; end if;
  if not public.has_role(v_uid, 'admin'::app_role) then
    raise exception 'apenas administradores podem decidir aprovações';
  end if;
  if r.status <> 'pending'::approval_status then
    raise exception 'pedido já decidido (status atual: %)', r.status;
  end if;

  update public.approval_requests
     set status = p_decision::approval_status,
         reviewed_by = v_uid, reviewed_at = now(), review_note = p_reason
   where id = p_id;

  insert into public.audit_log(company_id, user_id, action, target_type, target_id, details)
  values (r.company_id, v_uid,
          case when p_decision = 'approved' then 'approval_approved' else 'approval_rejected' end,
          'approval_request', p_id::text,
          jsonb_build_object('acao', r.action, 'resumo', r.summary, 'motivo', p_reason,
            'nota', case when p_decision = 'approved'
                         then case when r.action = 'registrar_veredito_peca'
                           then 'Veredito de compliance: aplicado AQUI mesmo, dentro do banco, no ato da aprovacao. Nao ha chamada a Meta nem fila. A assinatura gravada em pecas_em_revisao.veredito_por e a SUA, resolvida por auth.users - nao a que o agente sugeriu.'
                           else 'Aprovar DISPARA a execucao na hora: o trigger trg_executar_aprovacao chama a edge meta-actions no ato. Nao existe fila amadurecendo nem processamento em segundo plano. Segundos depois, o card ja carrega o desfecho: executed_at + execution_result.ok=true com o identificador do objeto, ou ultima_falha com o motivo. Card aprovado sem identificador ou FALHOU ou nao rodou - nunca "esta sendo processado".' end
                         end));

  if p_decision = 'approved' and r.action = 'registrar_veredito_peca' then
    v_veredito := public.aplicar_veredito_de_card(p_id);
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'novo_status', p_decision,
    'veredito_aplicado', v_veredito);
end;
$fn$;

-- 6) O portao de leitura passa a mostrar a nota estruturada e a ensinar o caminho novo.
create or replace function public.peca_bloqueada_por_revisao(
  p_company_id uuid, p_drive_file_id text default null, p_meta_video_id text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $fn$
declare
  v_drive text := nullif(trim(coalesce(p_drive_file_id,'')),'');
  v_video text := nullif(trim(coalesce(p_meta_video_id,'')),'');
  rev record;
  v_pendente uuid;
begin
  if v_drive is null and v_video is not null then
    select m.drive_file_id into v_drive
      from public.media_uploads m
     where m.company_id = p_company_id
       and m.meta_video_id = v_video
       and m.drive_file_id is not null
     order by m.enviado_em desc nulls last
     limit 1;
  end if;

  if v_drive is null then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', false);
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and bloqueia_uso is true
   order by aberto_em desc
   limit 1;

  if not found then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', true, 'drive_file_id', v_drive);
  end if;

  select a.id into v_pendente
    from public.approval_requests a
   where a.company_id = p_company_id
     and a.action = 'registrar_veredito_peca'
     and a.status = 'pending'
     and a.payload->>'peca_id' = rev.id::text
   limit 1;

  return jsonb_build_object(
    'bloqueada', true, 'peca_identificada', true, 'drive_file_id', v_drive,
    'nome', rev.nome, 'motivo', rev.motivo, 'regra_code', rev.regra_code,
    'aberto_em', rev.aberto_em, 'aberto_por', rev.aberto_por,
    'veredito', rev.veredito, 'veredito_em', rev.veredito_em, 'veredito_por', rev.veredito_por,
    'veredito_nota', rev.veredito_nota,
    'proposta_de_veredito_pendente', v_pendente,
    'mensagem', case
      when rev.veredito is null then
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito' ||
        case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end ||
        '. Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || coalesce(rev.aberto_por,'?') ||
        '. Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
        ' Isto NAO e ressalva para o gestor decidir no card de anuncio: enquanto nao houver veredito,' ||
        ' a peca nao vai para anuncio.' ||
        case when v_pendente is not null
          then ' JA EXISTE proposta de veredito aguardando decisao do administrador (card ' || left(v_pendente::text,8) || '): proposta NAO libera nada.'
          else ' Voce pode PROPOR um veredito com registrar_veredito_peca_em_revisao - isso emite um card que so o administrador aprova. Voce nao decide isso.' end
      else
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' tem veredito ' || rev.veredito || ' (em ' || to_char(rev.veredito_em,'DD/MM/YYYY') ||
        ' por ' || coalesce(rev.veredito_por,'?') || ') e permanece bloqueada para anuncio.' ||
        case when rev.regra_code is not null then ' Regra: ' || rev.regra_code || '.' else '' end ||
        ' Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
        case when rev.veredito_nota is not null then ' Nota do veredito: ' || rev.veredito_nota else '' end
    end);
end;
$fn$;
