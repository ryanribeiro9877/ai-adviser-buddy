-- Familia mensagens (Click-to-WhatsApp): CONVERSATIONS + WHATSAPP sob OUTCOME_ENGAGEMENT.
-- Corrige falha do card 7d6563df (JURIDICO_CONJ.01): sistema tratava CTWA como engajamento
-- social e rejeitava CONVERSATIONS / forçava ON_POST.

-- Page COHAPM usada nos conjuntos CTWA existentes (promoted_object).
update public.meta_execution_config
   set page_id = coalesce(nullif(page_id, ''), '105656372312257')
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'doutrina',
  $d$FAMILIA MENSAGENS / CLICK-TO-WHATSAPP (21/08/2026).

OUTCOME_ENGAGEMENT serve a DOIS caminhos distintos:
1) Engajamento SOCIAL (impulsão de post/Page): optimization_goal=POST_ENGAGEMENT (ou PAGE_LIKES/EVENT_RESPONSES/THRUPLAY) + destination_type=ON_POST|ON_PAGE|ON_EVENT|ON_VIDEO + page_id.
2) Mensagens / CTWA (conversas WhatsApp): familia_objetivo=mensagens + optimization_goal=CONVERSATIONS + destination_type=WHATSAPP + page_id (+ whatsapp_phone_number opcional).

A campanha COHAPM_JURIDICO_CONV_LEVA01 (ID 120249670682490182) e OUTCOME_ENGAGEMENT e e valida para CTWA.
Ao criar conjunto nela: use familia mensagens (nao engajamento social). Pode target_name=sem_molde.
Geo Jurídico Salvador–BA continua no preset automatico.

PROIBIDO: CONVERSATIONS + ON_POST; dizer que CONVERSATIONS nao e suportado em OUTCOME_ENGAGEMENT;
tratar CTWA como POST_ENGAGEMENT.$d$,
  true,
  current_date
);
