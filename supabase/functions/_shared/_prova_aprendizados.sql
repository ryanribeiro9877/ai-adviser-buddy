-- Prova SQL da memoria aprendida dos agentes (Tarefa 1): tabela agent_aprendizados,
-- trigger de isolamento por empresa e por linha, RLS, memoria_config e as RPCs de
-- busca, dedupe e uso.
--
-- Como rodar: execute_sql com este arquivo inteiro. Termina com a linha
-- 'PROVA_OK ...' = passou. Cada falha e um raise exception 'FALHA [caso]: ...'.
-- Tudo roda dentro de begin/rollback (inclusive a empresa e as contas Meta de teste),
-- entao nada fica no banco. Se a prova cair no meio, a transacao fica aberta e aborta:
-- rode "rollback;" antes de qualquer outra coisa.
--
-- Antes da migracao o esperado e parar logo na primeira linha com:
--   relation "public.agent_aprendizados" does not exist

begin;

-- 0. A tabela precisa existir. E o ponto onde a prova fica vermelha sem a migracao.
select 1 from public.agent_aprendizados limit 0;

-- Contas Meta de teste: uma com prefixo act_, uma so com digitos, uma da Legal.
-- A comparacao do trigger e so pelos digitos.
insert into public.meta_ad_accounts (account_id, company_id, nome) values
  ('act_1111111111', '57f755b9-c23d-4f58-a488-8173d697c010', 'prova cohapm com prefixo'),
  ('2222222222',     '57f755b9-c23d-4f58-a488-8173d697c010', 'prova cohapm sem prefixo'),
  ('act_3333333333', 'ded20b38-f42e-4c71-800c-31b97ea48bcf', 'prova legal');

-- Empresa so da prova: as contas e as ordenacoes ficam exatas, mesmo com dados reais
-- nas outras tres. Nao cita marca nenhuma, entao cai na regra das "demais empresas".
do $c$
declare v_id uuid;
begin
  insert into public.companies (name) values ('prova memoria aprendida (rollback)') returning id into v_id;
  perform set_config('prova.empresa', v_id::text, true);
end $c$;

-- ---------------------------------------------------------------------------
-- Ajudantes temporarios (somem no rollback)
-- ---------------------------------------------------------------------------
create function pg_temp.cohapm() returns uuid language sql as $f$ select '57f755b9-c23d-4f58-a488-8173d697c010'::uuid $f$;
create function pg_temp.legal()  returns uuid language sql as $f$ select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid $f$;
create function pg_temp.coop()   returns uuid language sql as $f$ select '307849e6-78a7-4217-8112-3fb0a924f988'::uuid $f$;
create function pg_temp.prova_co() returns uuid language sql as $f$ select current_setting('prova.empresa')::uuid $f$;

create function pg_temp.afirma(p_caso text, p_cond boolean) returns void language plpgsql as $f$
begin
  if p_cond is not true then
    raise exception 'FALHA [%]', p_caso;
  end if;
end $f$;

-- Insere com valores neutros. A chave normalizada vem do fato quando nao e informada.
create function pg_temp.ins(
  p_company uuid, p_fato text, p_linha text default null, p_contexto text default null,
  p_categoria text default 'processo', p_chave text default null,
  p_confianca text default 'confirmada', p_valido_ate date default null, p_evid jsonb default null
) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.agent_aprendizados
    (company_id, linha, categoria, fato, contexto, evidencias, agente_codigo, superficie, confianca, valido_ate, chave_normalizada)
  values
    (p_company, p_linha, p_categoria, p_fato, p_contexto,
     coalesce(p_evid, '[{"tipo":"fala_do_gestor","trecho":"prova","em":"2026-10-17T12:00:00Z"}]'::jsonb),
     'AG-00', 'chat', p_confianca, p_valido_ate,
     coalesce(p_chave, regexp_replace(lower(public.f_unaccent(p_fato)), '[^a-z0-9 ]', '', 'g')))
  returning id into v_id;
  return v_id;
end $f$;

-- Tem de passar: devolve o id.
create function pg_temp.ok_ins(
  p_caso text, p_company uuid, p_fato text, p_linha text default null, p_contexto text default null,
  p_categoria text default 'processo', p_chave text default null,
  p_confianca text default 'confirmada', p_valido_ate date default null, p_evid jsonb default null
) returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  begin
    v_id := pg_temp.ins(p_company, p_fato, p_linha, p_contexto, p_categoria, p_chave, p_confianca, p_valido_ate, p_evid);
  exception when others then
    raise exception 'FALHA [%]: deveria passar e falhou com: %', p_caso, sqlerrm;
  end;
  return v_id;
end $f$;

-- Tem de falhar com a mensagem (ou o sqlstate) esperada.
create function pg_temp.nega_ins(
  p_caso text, p_esperado text, p_company uuid, p_fato text, p_linha text default null, p_contexto text default null,
  p_categoria text default 'processo', p_chave text default null,
  p_confianca text default 'confirmada', p_valido_ate date default null, p_evid jsonb default null
) returns void language plpgsql as $f$
declare v_id uuid; v_msg text; v_state text;
begin
  begin
    v_id := pg_temp.ins(p_company, p_fato, p_linha, p_contexto, p_categoria, p_chave, p_confianca, p_valido_ate, p_evid);
  exception when others then
    v_msg := sqlerrm; v_state := sqlstate;
  end;
  if v_msg is null then
    raise exception 'FALHA [%]: deveria falhar com % e foi gravado', p_caso, p_esperado;
  end if;
  if v_msg <> p_esperado and v_state <> p_esperado then
    raise exception 'FALHA [%]: esperava %, veio % (%)', p_caso, p_esperado, v_msg, v_state;
  end if;
end $f$;

-- Mesma ideia para um comando qualquer.
create function pg_temp.nega(p_caso text, p_esperado text, p_sql text) returns void language plpgsql as $f$
declare v_msg text; v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm; v_state := sqlstate;
  end;
  if v_msg is null then
    raise exception 'FALHA [%]: deveria falhar com % e passou', p_caso, p_esperado;
  end if;
  if v_msg <> p_esperado and v_state <> p_esperado then
    raise exception 'FALHA [%]: esperava %, veio % (%)', p_caso, p_esperado, v_msg, v_state;
  end if;
end $f$;

-- ---------------------------------------------------------------------------
-- A prova
-- ---------------------------------------------------------------------------
do $prova$
declare
  c_cohapm constant uuid := '57f755b9-c23d-4f58-a488-8173d697c010';
  c_legal  constant uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
  c_coop   constant uuid := '307849e6-78a7-4217-8112-3fb0a924f988';
  c_prova  constant uuid := pg_temp.prova_co();
  v_pref uuid; v_id uuid; v_n int; v_s real; v_txt text; v_state text;
  p1 uuid; p2 uuid; p3 uuid; f1 uuid; f2 uuid; f3 uuid; v_venc uuid; v_hoje uuid; v_subst uuid; v_apos uuid;
  k_jur constant text := 'o juridico exige revisao antes de subir o criativo';
  v_user uuid; v_co_user uuid; v_admin boolean;
begin
  -- ===== 1. Trava de empresa =====
  -- COHAPM
  v_pref := pg_temp.ok_ins('cohapm: preferencia do gestor passa', c_cohapm,
    'o gestor prefere ver custo por conversa antes do CPL',
    p_categoria => 'preferencia_do_gestor', p_chave => 'o gestor prefere ver custo por conversa antes do cpl');
  perform pg_temp.nega_ins('cohapm cita Legal e Viver', 'aprendizado_cita_outra_empresa', c_cohapm,
    'seguir o padrao da Legal e Viver');
  perform pg_temp.nega_ins('cohapm cita Legal é Viver com acento', 'aprendizado_cita_outra_empresa', c_cohapm,
    'seguir o padrão da Legal é Viver');
  perform pg_temp.nega_ins('cohapm cita consignado CLT', 'aprendizado_cita_outra_empresa', c_cohapm,
    'usar o argumento do consignado CLT nas pecas');
  perform pg_temp.nega_ins('cohapm cita a sigla LEV', 'aprendizado_cita_outra_empresa', c_cohapm,
    'a sigla LEV aparece nos anuncios da conta');
  perform pg_temp.nega_ins('cohapm cita Legal e Viver so no contexto', 'aprendizado_cita_outra_empresa', c_cohapm,
    'o gestor corrigiu o texto das pecas do mes', p_contexto => 'copiado de Legal e Viver');
  perform pg_temp.ok_ins('cohapm: levantamento nao e LEV', c_cohapm,
    'o levantamento dos dados da conta vale para o mes');
  perform pg_temp.ok_ins('cohapm pode citar La Felicita (e linha dela)', c_cohapm,
    'o tom da La Felicità e mais acolhedor que o dos outros');
  -- Legal
  perform pg_temp.nega_ins('legal cita La Felicita', 'aprendizado_cita_outra_empresa', c_legal,
    'copiar o tom da La Felicita');
  perform pg_temp.nega_ins('legal cita Lafelicita junto', 'aprendizado_cita_outra_empresa', c_legal,
    'padrao da Lafelicita nas legendas');
  perform pg_temp.nega_ins('legal cita COHAPM', 'aprendizado_cita_outra_empresa', c_legal,
    'comparar com a cooperativa COHAPM nos relatorios');
  perform pg_temp.ok_ins('legal pode citar a propria marca', c_legal,
    'o gestor prefere relatorio curto na Legal e Viver');
  -- Cooperativa: marca COHAPM e dela, Legal e La Felicita nao
  perform pg_temp.ok_ins('cooperativa cita COHAPM', c_coop,
    'a cooperativa COHAPM atende servidores');
  perform pg_temp.nega_ins('cooperativa cita Legal e Viver', 'aprendizado_cita_outra_empresa', c_coop,
    'seguir o padrao da Legal e Viver');
  perform pg_temp.nega_ins('cooperativa cita La Felicita', 'aprendizado_cita_outra_empresa', c_coop,
    'copiar o tom da La Felicita');
  -- Empresa da prova (demais empresas)
  perform pg_temp.nega_ins('demais cita Legal e Viver', 'aprendizado_cita_outra_empresa', c_prova,
    'seguir o padrao da Legal e Viver');
  perform pg_temp.nega_ins('demais cita La Felicita', 'aprendizado_cita_outra_empresa', c_prova,
    'copiar o tom da La Felicita');
  perform pg_temp.ok_ins('demais pode citar COHAPM', c_coop,
    'a cooperativa COHAPM e referencia de tom');

  -- UPDATE tambem passa pela trava (e a rede final contra reescrita)
  perform pg_temp.nega('update cita Legal e Viver', 'aprendizado_cita_outra_empresa',
    format($q$update public.agent_aprendizados set fato = 'seguir o padrao da Legal e Viver' where id = %L$q$, v_pref));

  -- ===== 2. Contas Meta (act_) =====
  perform pg_temp.nega_ins('act_ fora de meta_ad_accounts', 'aprendizado_cita_conta_alheia', c_cohapm,
    'a conta act_9999999999 tem o orcamento no conjunto');
  perform pg_temp.ok_ins('act_ da propria empresa (com prefixo)', c_cohapm,
    'a conta act_1111111111 tem o orcamento no conjunto');
  perform pg_temp.ok_ins('act_ da propria empresa (tabela sem prefixo)', c_cohapm,
    'a conta act_2222222222 usa campanha de mensagens');
  perform pg_temp.nega_ins('act_ de outra empresa', 'aprendizado_cita_conta_alheia', c_cohapm,
    'a conta act_3333333333 tem o orcamento no conjunto');
  perform pg_temp.nega_ins('act_ alheia so no contexto', 'aprendizado_cita_conta_alheia', c_cohapm,
    'o orcamento fica no conjunto de anuncios', p_contexto => 'visto na conta act_9999999999');
  perform pg_temp.nega_ins('act_ propria e alheia juntas', 'aprendizado_cita_conta_alheia', c_cohapm,
    'comparar act_1111111111 com act_9999999999 no relatorio');
  perform pg_temp.nega_ins('act_ em maiuscula', 'aprendizado_cita_conta_alheia', c_cohapm,
    'a conta ACT_9999999999 tem o orcamento no conjunto');
  perform pg_temp.ok_ins('act_ da Legal na Legal', c_legal,
    'a conta act_3333333333 usa campanha de mensagens');

  -- ===== 3. Trava de linha =====
  perform pg_temp.nega_ins('linha juridico cita La Felicita', 'aprendizado_cita_outra_linha', c_cohapm,
    'usar a mesma copy da La Felicita', p_linha => 'juridico');
  perform pg_temp.nega_ins('linha la_felicita cita juridico com acento', 'aprendizado_cita_outra_linha', c_cohapm,
    'o texto do jurídico precisa de cuidado', p_linha => 'la_felicita');
  perform pg_temp.nega_ins('linha la_felicita cita o sistema ocular', 'aprendizado_cita_outra_linha', c_cohapm,
    'mesmo fluxo do sistema ocular no formulario', p_linha => 'la_felicita');
  perform pg_temp.nega_ins('linha juridico cita Vistta', 'aprendizado_cita_outra_linha', c_cohapm,
    'mesmo fluxo do Vistta no formulario', p_linha => 'juridico');
  perform pg_temp.nega_ins('linha sistema_ocular cita juridico', 'aprendizado_cita_outra_linha', c_cohapm,
    'o juridico revisa o texto antes do ocular', p_linha => 'sistema_ocular');
  perform pg_temp.ok_ins('linha sistema_ocular cita a propria marca', c_cohapm,
    'o Vistta pede o nome completo no formulario', p_linha => 'sistema_ocular');
  perform pg_temp.nega_ins('linha juridico cita oculos', 'aprendizado_cita_outra_linha', c_cohapm,
    'mesmo fluxo de óculos no formulario', p_linha => 'juridico');
  perform pg_temp.nega_ins('linha juridico cita a sigla LAF', 'aprendizado_cita_outra_linha', c_cohapm,
    'usar o criativo do LAF no anuncio', p_linha => 'juridico');
  perform pg_temp.nega_ins('linha juridico cita La Felicita so no contexto', 'aprendizado_cita_outra_linha', c_cohapm,
    'o formulario tem tres campos', p_linha => 'juridico', p_contexto => 'visto na La Felicita');
  perform pg_temp.ok_ins('linha juridico cita o proprio juridico', c_cohapm,
    'o juridico agenda reuniao presencial com advogado', p_linha => 'juridico');
  perform pg_temp.ok_ins('linha la_felicita cita a propria marca', c_cohapm,
    'a La Felicita visita no sabado de manha', p_linha => 'la_felicita');
  perform pg_temp.ok_ins('linha juridico: Lafaiete nao e LAF', c_cohapm,
    'reuniao em Lafaiete com o advogado e presencial', p_linha => 'juridico');
  perform pg_temp.ok_ins('sem linha (empresa toda) pode citar duas linhas', c_cohapm,
    'a La Felicita e o juridico usam o mesmo pixel da conta');

  -- ===== 4. Unicidade entre vigentes =====
  v_id := pg_temp.ok_ins('unicidade: primeiro', c_cohapm, 'o gestor quer o relatorio semanal na segunda');
  perform pg_temp.nega_ins('unicidade: mesma chave na mesma empresa', '23505', c_cohapm,
    'o gestor quer o relatorio semanal na segunda');
  perform pg_temp.ok_ins('unicidade: mesma chave em outra empresa', c_coop,
    'o gestor quer o relatorio semanal na segunda');
  update public.agent_aprendizados set status = 'substituida', motivo_status = 'prova' where id = v_id;
  perform pg_temp.ok_ins('unicidade: so vale entre vigentes', c_cohapm,
    'o gestor quer o relatorio semanal na segunda');

  -- ===== 5. Forma (checks) =====
  perform pg_temp.nega_ins('fato com 19 chars', '23514', c_cohapm, 'fato curto demais!!');
  perform pg_temp.ok_ins('fato com 20 chars', c_cohapm, 'vinte caracteres ok!');
  perform pg_temp.nega_ins('fato com 601 chars', '23514', c_cohapm, repeat('a ', 300) || 'x');
  perform pg_temp.nega_ins('contexto com 1501 chars', '23514', c_cohapm,
    'o gestor prefere o resumo curto no topo', p_contexto => repeat('x', 1501));
  perform pg_temp.nega_ins('categoria invalida', '23514', c_cohapm,
    'o gestor prefere o resumo curto no topo', p_categoria => 'invalida');
  perform pg_temp.nega_ins('evidencias vazias', '23514', c_cohapm,
    'o gestor prefere o resumo curto no topo', p_evid => '[]'::jsonb);
  perform pg_temp.nega_ins('evidencias nao e array', '23514', c_cohapm,
    'o gestor prefere o resumo curto no topo', p_evid => '{"tipo":"fala_do_gestor"}'::jsonb);
  perform pg_temp.nega_ins('confianca invalida', '23514', c_cohapm,
    'o gestor prefere o resumo curto no topo', p_confianca => 'chute');
  v_id := pg_temp.ok_ins('motivo: linha base', c_cohapm, 'o gestor prefere o resumo curto no topo');
  perform pg_temp.nega('sair de vigente exige motivo', '23514',
    format($q$update public.agent_aprendizados set status = 'aposentada' where id = %L$q$, v_id));
  update public.agent_aprendizados set status = 'aposentada', motivo_status = 'prova' where id = v_id;
  perform pg_temp.afirma('sair de vigente com motivo passa',
    (select status = 'aposentada' from public.agent_aprendizados where id = v_id));
  -- a coluna de busca (gerada) acha por palavra, com acento e sem
  perform pg_temp.afirma('busca gerada acha o fato',
    exists (select 1 from public.agent_aprendizados a
            where a.company_id = c_cohapm
              and a.busca @@ plainto_tsquery('portuguese', public.f_unaccent('relatório semanal na segunda'))));

  -- ===== 6. consultar_aprendizados (empresa da prova, contagens exatas) =====
  p1 := pg_temp.ok_ins('c: p1', c_prova, 'prefiro receber o resumo em topicos curtos sempre',
    p_categoria => 'preferencia_do_gestor');
  p2 := pg_temp.ok_ins('c: p2', c_prova, 'prefiro que a analise do juridico traga o custo por conversa primeiro',
    p_linha => 'juridico', p_categoria => 'preferencia_do_gestor');
  p3 := pg_temp.ok_ins('c: p3', c_prova, 'prefiro legendas acolhedoras para o residencial',
    p_linha => 'la_felicita', p_categoria => 'preferencia_do_gestor');
  f1 := pg_temp.ok_ins('c: f1', c_prova, 'a conta usa orcamento no nivel do conjunto de anuncios',
    p_categoria => 'fato_da_conta');
  f2 := pg_temp.ok_ins('c: f2', c_prova, 'o residencial converte melhor com formulario curto',
    p_linha => 'la_felicita', p_categoria => 'fato_da_conta', p_confianca => 'observada');
  f3 := pg_temp.ok_ins('c: f3', c_prova, 'o juridico nao pode prometer resultado no anuncio',
    p_linha => 'juridico', p_categoria => 'armadilha');
  v_venc := pg_temp.ok_ins('c: vencida', c_prova, 'fato vencido sobre orcamento do conjunto de anuncios',
    p_categoria => 'fato_da_conta', p_valido_ate => current_date - 1);
  v_hoje := pg_temp.ok_ins('c: vale ate hoje', c_prova, 'fato com prazo ate hoje sobre o rodizio de criativos',
    p_categoria => 'fato_da_conta', p_valido_ate => current_date);
  v_subst := pg_temp.ok_ins('c: substituida', c_prova, 'fato antigo substituido sobre orcamento do conjunto');
  v_apos  := pg_temp.ok_ins('c: aposentada', c_prova, 'fato aposentado sobre orcamento do conjunto');
  update public.agent_aprendizados set status = 'substituida', motivo_status = 'prova' where id = v_subst;
  update public.agent_aprendizados set status = 'aposentada',  motivo_status = 'prova' where id = v_apos;
  update public.agent_aprendizados set confirmacoes = 3 where id = p1;
  update public.agent_aprendizados set confirmacoes = 2 where id = p3;

  -- recorte por linha: la_felicita ve a propria e a nula, nunca a juridico
  perform pg_temp.afirma('linhas=[la_felicita]: nada de juridico',
    not exists (select 1 from public.consultar_aprendizados(c_prova, array['la_felicita'], 'legenda do residencial', 10, 5, false) c
                where c.linha = 'juridico'));
  perform pg_temp.afirma('linhas=[la_felicita]: devolve linha nula e la_felicita',
    (select array_agg(c.id order by c.id) from public.consultar_aprendizados(c_prova, array['la_felicita'], 'legenda do residencial', 10, 5, false) c)
    = (select array_agg(x order by x) from unnest(array[p1, p3, f1, f2, v_hoje]) x));
  perform pg_temp.afirma('linhas=null: devolve todas as linhas',
    (select array_agg(c.id order by c.id) from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, false) c)
    = (select array_agg(x order by x) from unnest(array[p1, p2, p3, f1, f2, f3, v_hoje]) x));
  perform pg_temp.afirma('linhas=[]: so linha nula',
    (select array_agg(c.id order by c.id) from public.consultar_aprendizados(c_prova, '{}'::text[], 'x', 10, 5, false) c)
    = (select array_agg(x order by x) from unnest(array[p1, f1, v_hoje]) x));
  -- vigente e prazo: vencida, substituida e aposentada ficam de fora; "ate hoje" entra
  perform pg_temp.afirma('vencida/substituida/aposentada nao entram',
    not exists (select 1 from public.consultar_aprendizados(c_prova, null, 'orcamento do conjunto', 20, 5, false) c
                where c.id in (v_venc, v_subst, v_apos)));
  -- preferencias primeiro, por confirmacoes; o resto como relevante
  perform pg_temp.afirma('preferencias na frente, por confirmacoes',
    (select array_agg(c.id order by o) from (select c.id, row_number() over () o from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, false) c limit 3) c)
    = array[p1, p3, p2]);
  perform pg_temp.afirma('motivo preferencia x relevante',
    (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, false) c where c.motivo = 'preferencia' and c.categoria = 'preferencia_do_gestor') = 3
    and (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, false) c where c.motivo = 'relevante') = 4);
  -- teto: as preferencias contam dentro do limite
  perform pg_temp.afirma('limite 3 e max_pref 2: 2 preferencias + 1 relevante',
    (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 3, 2, false) c) = 3
    and (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 3, 2, false) c where c.motivo = 'preferencia') = 2);
  perform pg_temp.afirma('limite 1: so a preferencia mais confirmada',
    (select array_agg(c.id) from public.consultar_aprendizados(c_prova, null, 'x', 1, 5, false) c) = array[p1]);
  perform pg_temp.afirma('max_pref 0: ninguem entra como preferencia',
    (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 10, 0, false) c where c.motivo = 'preferencia') = 0
    and (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 10, 0, false) c) = 7);
  perform pg_temp.afirma('limite 0: nada',
    (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 0, 5, false) c) = 0);
  -- so confirmadas
  perform pg_temp.afirma('somente confirmadas: sem observada',
    not exists (select 1 from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, true) c where c.confianca <> 'confirmada' or c.id = f2)
    and (select count(*) from public.consultar_aprendizados(c_prova, null, 'x', 10, 5, true) c) = 6);
  -- relevancia: quem casa com o texto vem primeiro, com e sem acento
  perform pg_temp.afirma('texto: o fato que casa vem primeiro',
    (select c.id from public.consultar_aprendizados(c_prova, null, 'orcamento do conjunto de anuncios', 10, 0, false) c limit 1) = f1);
  perform pg_temp.afirma('texto com acento acha igual',
    (select c.id from public.consultar_aprendizados(c_prova, null, 'orçamento do conjunto de anúncios', 10, 0, false) c limit 1) = f1);
  perform pg_temp.afirma('texto de uma palavra do fato (OR, nao AND)',
    (select c.id from public.consultar_aprendizados(c_prova, null, 'rodizio de criativos na conta inteira', 10, 0, false) c limit 1) = v_hoje);
  -- texto vazio, nulo ou so de stopwords nao quebra
  perform pg_temp.afirma('texto nulo nao quebra', (select count(*) from public.consultar_aprendizados(c_prova, null, null, 10, 5, false) c) = 7);
  perform pg_temp.afirma('texto vazio nao quebra', (select count(*) from public.consultar_aprendizados(c_prova, null, '', 10, 5, false) c) = 7);
  perform pg_temp.afirma('texto so de stopwords nao quebra', (select count(*) from public.consultar_aprendizados(c_prova, null, 'de a o', 10, 5, false) c) = 7);
  -- isolamento entre empresas
  perform pg_temp.afirma('outra empresa nao ve as linhas da empresa da prova',
    not exists (select 1 from public.consultar_aprendizados(c_cohapm, null, 'orcamento do conjunto', 50, 50, false) c
                where c.id in (p1, p2, p3, f1, f2, f3, v_hoje)));
  perform pg_temp.afirma('a empresa da prova nao ve as da COHAPM',
    not exists (select 1 from public.consultar_aprendizados(c_prova, null, 'relatorio semanal', 50, 50, false) c where c.id = v_pref));

  -- ===== 7. aprendizados_parecidos =====
  -- v_pref: COHAPM, linha nula, chave 'o gestor prefere ver custo por conversa antes do cpl'
  select p.similaridade into v_s from public.aprendizados_parecidos(c_cohapm, null,
    'o gestor prefere ver custo por conversa antes do cpa') p where p.id = v_pref;
  perform pg_temp.afirma('parecidos: uma palavra trocada passa de 0.8 (v=' || coalesce(v_s::text, 'nulo') || ')', v_s >= 0.8);
  select p.similaridade into v_s from public.aprendizados_parecidos(c_cohapm, null,
    'o gestor prefere ver custo por conversa antes do cpl') p where p.id = v_pref;
  perform pg_temp.afirma('parecidos: chave identica vale 1', v_s = 1);
  perform pg_temp.afirma('parecidos: reescrita mais solta fica abaixo de 0.8',
    not exists (select 1 from public.aprendizados_parecidos(c_cohapm, null,
      'o gestor gosta de ver custo por conversa antes do cpl') p where p.id = v_pref));
  perform pg_temp.afirma('parecidos: limiar explicito mais baixo traz a reescrita solta',
    exists (select 1 from public.aprendizados_parecidos(c_cohapm, null,
      'o gestor gosta de ver custo por conversa antes do cpl', 0.7) p where p.id = v_pref));
  perform pg_temp.afirma('parecidos: p_linha de uma linha ainda ve o fato de linha nula',
    exists (select 1 from public.aprendizados_parecidos(c_cohapm, 'la_felicita',
      'o gestor prefere ver custo por conversa antes do cpl') p where p.id = v_pref));
  perform pg_temp.afirma('parecidos: outra empresa nao ve',
    not exists (select 1 from public.aprendizados_parecidos(c_legal, null,
      'o gestor prefere ver custo por conversa antes do cpl') p where p.id = v_pref));
  -- linha: so a mesma linha ou a linha nula
  v_id := pg_temp.ok_ins('parecidos: linha juridico', c_prova, k_jur, p_linha => 'juridico', p_chave => k_jur);
  perform pg_temp.afirma('parecidos: mesma linha acha',
    exists (select 1 from public.aprendizados_parecidos(c_prova, 'juridico', k_jur) p where p.id = v_id));
  perform pg_temp.afirma('parecidos: outra linha nao acha',
    not exists (select 1 from public.aprendizados_parecidos(c_prova, 'la_felicita', k_jur) p where p.id = v_id));
  perform pg_temp.afirma('parecidos: p_linha nula so casa com linha nula',
    not exists (select 1 from public.aprendizados_parecidos(c_prova, null, k_jur) p where p.id = v_id));
  -- so vigente
  update public.agent_aprendizados set status = 'aposentada', motivo_status = 'prova' where id = v_id;
  perform pg_temp.afirma('parecidos: so entre vigentes',
    not exists (select 1 from public.aprendizados_parecidos(c_prova, 'juridico', k_jur) p where p.id = v_id));

  -- ===== 8. reforcar_aprendizado =====
  perform pg_temp.afirma('reforco: ponto de partida',
    (select confirmacoes = 1 and jsonb_array_length(evidencias) = 1 from public.agent_aprendizados where id = v_pref));
  perform public.reforcar_aprendizado(v_pref,
    '{"tipo":"fala_do_gestor","trecho":"de novo","em":"2026-10-17T13:00:00Z"}'::jsonb);
  perform pg_temp.afirma('reforco: confirmacoes 2 e 2 evidencias',
    (select confirmacoes = 2 and jsonb_array_length(evidencias) = 2 from public.agent_aprendizados where id = v_pref));
  perform public.reforcar_aprendizado(v_pref, null);
  perform pg_temp.afirma('reforco sem evidencia: so soma',
    (select confirmacoes = 3 and jsonb_array_length(evidencias) = 2 from public.agent_aprendizados where id = v_pref));
  perform public.reforcar_aprendizado(v_pref,
    '[{"tipo":"fala_do_gestor","trecho":"a","em":"2026-10-17T14:00:00Z"},{"tipo":"fala_do_gestor","trecho":"b","em":"2026-10-17T14:01:00Z"}]'::jsonb);
  perform pg_temp.afirma('reforco com lista: concatena',
    (select confirmacoes = 4 and jsonb_array_length(evidencias) = 4 from public.agent_aprendizados where id = v_pref));
  perform public.reforcar_aprendizado(v_subst, '{"tipo":"fala_do_gestor","trecho":"x","em":"2026-10-17T13:00:00Z"}'::jsonb);
  perform pg_temp.afirma('reforco de registro que nao e vigente nao mexe',
    (select confirmacoes = 1 and jsonb_array_length(evidencias) = 1 from public.agent_aprendizados where id = v_subst));
  perform public.reforcar_aprendizado('00000000-0000-0000-0000-000000000000', '{"tipo":"x"}'::jsonb);

  -- ===== 9. marcar_uso_aprendizados =====
  perform pg_temp.afirma('uso: ponto de partida',
    (select usos = 0 and ultimo_uso is null from public.agent_aprendizados where id = p1));
  perform public.marcar_uso_aprendizados(array[p1, p3]);
  perform pg_temp.afirma('uso: soma 1 e marca a hora',
    (select usos = 1 and ultimo_uso is not null from public.agent_aprendizados where id = p1)
    and (select usos = 1 from public.agent_aprendizados where id = p3)
    and (select usos = 0 and ultimo_uso is null from public.agent_aprendizados where id = p2));
  perform public.marcar_uso_aprendizados(array[p1]);
  perform pg_temp.afirma('uso: segunda vez soma de novo', (select usos = 2 from public.agent_aprendizados where id = p1));
  perform public.marcar_uso_aprendizados(array[]::uuid[]);
  perform public.marcar_uso_aprendizados(null);

  -- ===== 10. Estrutura, config e permissoes =====
  perform pg_temp.afirma('f_unaccent tira acento', public.f_unaccent('Felicità Jurídico óculos') = 'Felicita Juridico oculos');
  perform pg_temp.afirma('f_unaccent e imutavel',
    (select provolatile = 'i' from pg_proc where oid = 'public.f_unaccent(text)'::regprocedure));
  perform pg_temp.afirma('memoria_config: uma linha, tudo ligado',
    (select count(*) = 1 and bool_and(consulta_ativa) and bool_and(gravacao_ativa) from public.memoria_config));
  perform pg_temp.nega('memoria_config: so uma linha', '23505', $q$insert into public.memoria_config (id) values (true)$q$);
  perform pg_temp.nega('memoria_config: id false nao existe', '23514', $q$insert into public.memoria_config (id) values (false)$q$);
  perform pg_temp.afirma('RLS ligada nas duas tabelas',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.agent_aprendizados'::regclass, 'public.memoria_config'::regclass)));
  perform pg_temp.afirma('so uma policy, de select, para membros',
    (select count(*) = 1 and bool_and(cmd = 'SELECT') and bool_and(qual ilike '%is_company_member%')
     from pg_policies where schemaname = 'public' and tablename = 'agent_aprendizados'));
  perform pg_temp.afirma('anon e authenticated nao escrevem na tabela',
    not has_table_privilege('anon', 'public.agent_aprendizados', 'select')
    and not has_table_privilege('anon', 'public.agent_aprendizados', 'insert')
    and not has_table_privilege('authenticated', 'public.agent_aprendizados', 'insert')
    and not has_table_privilege('authenticated', 'public.agent_aprendizados', 'update')
    and not has_table_privilege('authenticated', 'public.agent_aprendizados', 'delete')
    and has_table_privilege('authenticated', 'public.agent_aprendizados', 'select')
    and has_table_privilege('service_role', 'public.agent_aprendizados', 'insert'));
  perform pg_temp.afirma('memoria_config fechada para anon e authenticated',
    not has_table_privilege('anon', 'public.memoria_config', 'select')
    and not has_table_privilege('authenticated', 'public.memoria_config', 'select')
    and not has_table_privilege('authenticated', 'public.memoria_config', 'update'));
  perform pg_temp.afirma('RPCs: execute so para service_role',
    (select bool_and(not has_function_privilege('anon', f, 'execute')
                     and not has_function_privilege('authenticated', f, 'execute')
                     and has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
       'public.consultar_aprendizados(uuid, text[], text, integer, integer, boolean)',
       'public.aprendizados_parecidos(uuid, text, text, real)',
       'public.reforcar_aprendizado(uuid, jsonb)',
       'public.marcar_uso_aprendizados(uuid[])']) f));
  perform pg_temp.afirma('RPCs: security definer com search_path = public',
    (select bool_and(prosecdef and proconfig @> array['search_path=public'])
     from pg_proc where oid in (
       'public.consultar_aprendizados(uuid, text[], text, integer, integer, boolean)'::regprocedure,
       'public.aprendizados_parecidos(uuid, text, text, real)'::regprocedure,
       'public.reforcar_aprendizado(uuid, jsonb)'::regprocedure,
       'public.marcar_uso_aprendizados(uuid[])'::regprocedure)));
  perform pg_temp.afirma('indices: unico parcial, GIN da busca e GIN trigram da chave',
    (select count(*) = 3 from pg_indexes where schemaname = 'public' and tablename = 'agent_aprendizados'
       and (indexdef ilike '%unique%(company_id, chave_normalizada)%where%vigente%'
         or indexdef ilike '%using gin (busca)%'
         or indexdef ilike '%using gin (chave_normalizada%gin_trgm_ops%')));

  -- authenticated nao executa a RPC (permissao negada), service_role/postgres executa
  begin
    set local role authenticated;
    perform 1 from public.consultar_aprendizados(c_prova, null, 'x', 5, 5, false);
    v_state := 'executou';
  exception when others then
    v_state := sqlstate;
  end;
  reset role;
  perform pg_temp.afirma('authenticated chamando a RPC leva 42501 (veio ' || coalesce(v_state, 'nulo') || ')', v_state = '42501');

  -- RLS de verdade: quem nao e membro nao le nada
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.agent_aprendizados;
  reset role;
  perform pg_temp.afirma('RLS: nao membro le 0 linhas (leu ' || v_n || ')', v_n = 0);

  -- RLS: um membro real le a propria empresa (so se houver membro cadastrado)
  select cm.user_id, cm.company_id into v_user, v_co_user from public.company_members cm limit 1;
  if v_user is not null then
    v_admin := public.has_role(v_user, 'admin');
    v_id := pg_temp.ok_ins('rls: linha da empresa do membro', v_co_user, 'registro neutro para provar a leitura do membro');
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.agent_aprendizados where id = v_id;
    select count(*) into v_s from public.agent_aprendizados where company_id = c_prova;
    reset role;
    perform pg_temp.afirma('RLS: membro le a linha da propria empresa', v_n = 1);
    if not v_admin and v_co_user <> c_prova then
      perform pg_temp.afirma('RLS: membro nao le a empresa da prova', v_s = 0);
    end if;
  end if;
end $prova$;

rollback;

select 'PROVA_OK: todos os casos da memoria aprendida (Tarefa 1) passaram e nada ficou no banco' as resultado;
