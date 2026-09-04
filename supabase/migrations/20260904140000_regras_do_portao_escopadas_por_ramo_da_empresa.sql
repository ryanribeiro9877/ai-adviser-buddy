-- ESCOPO DAS REGRAS DO PORTAO POR RAMO DO NEGOCIO
--
-- Motivo, medido e nao suposto: as 10 regras de credito valem GLOBALMENTE no portao, e uma
-- delas ja reprova peca que nao e de credito. `checar_par_texto_e_peca` sobre a peca
-- "Criativo 01.jpeg" do Sistema Ocular (VISTTA) devolve veredito = 'reprova' por FIN-04
-- (taxa citada sem CET), porque a peca diz "oculos novos todos os anos por parcelas de
-- R$79,00/mes". CET e informacao bancaria; exigi-la de anuncio de OCULOS e falso positivo de
-- regra de BLOQUEIO, em producao, hoje.
--
-- Isso corrige uma afirmacao minha da entrega anterior. Eu disse que abrir a edge
-- `compliance-check` para a COHAPM "exporia as 10 regras de credito a um negocio que nao e de
-- credito". A exposicao JA EXISTE, e por um caminho pior: a edge e opcional, mas
-- `checar_par_texto_e_peca` e o que roda na emissao do anuncio. O recorte da edge nunca foi a
-- protecao que eu supus que fosse.
--
-- =========================================================================================
-- 1. A COLUNA DE ESCOPO, QUE EU HAVIA RECUSADO CRIAR
-- =========================================================================================
-- Na entrega anterior registrei que a solucao estrutural seria uma coluna `escopo` e que eu
-- nao a criaria por mexer em tabela com seis consumidores vivos. A medicao acima muda a
-- conta: o custo de nao ter a coluna e bloqueio indevido de peca legitima. Crio agora, com
-- default 'qualquer', para que consumidor que nao filtra continue vendo tudo — ninguem perde
-- regra por causa desta migration.
alter table public.promessas_proibidas
  add column if not exists ramo text not null default 'qualquer';

alter table public.promessas_proibidas
  drop constraint if exists promessas_proibidas_ramo_check;
alter table public.promessas_proibidas
  add constraint promessas_proibidas_ramo_check
  check (ramo in ('qualquer', 'credito', 'juridico'));

comment on column public.promessas_proibidas.ramo is
  'Ramo do negocio a que a regra se aplica. "qualquer" vale para toda empresa e e o default de proposito: regra nova entra ampla e so estreita por decisao explicita. O conjunto de valores e deliberadamente pequeno - so existe ramo aqui quando existe regra para ele.';

-- As 9 de credito. FIN-* sao de oferta de credito; LGL-01 ("ganho/presente/bonus para
-- emprestimo") tambem pressupoe oferta de emprestimo.
update public.promessas_proibidas
   set ramo = 'credito'
 where regra_code like 'FIN-%' or regra_code = 'LGL-01';

-- As 5 de publicidade advocaticia.
update public.promessas_proibidas
   set ramo = 'juridico'
 where regra_code like 'LGL-JUR-%';

-- A unica sem regra_code ("maior limite / comparativo sem prova") fica em 'qualquer', e nao
-- por descuido: o padrao dela pega "o melhor do mercado" e "imbativel", que sao superlativo
-- publicitario sem prova — vedado pelo CDC art. 37 §1º para QUALQUER ramo, nao so para
-- credito. Efeito colateral desejado: toda empresa conhecida sempre tem no minimo uma regra
-- ativa, entao o escopo por ramo nunca produz portao vazio por construcao.
update public.promessas_proibidas
   set ramo = 'qualquer'
 where regra_code is null;

-- =========================================================================================
-- 2. DE ONDE VEM O RAMO
-- =========================================================================================
-- Nao criei campo novo: a informacao ja existe, espalhada em `companies.industry`,
-- `brand_identity.marca_nome` e `brand_identity.linhas_produto`. A funcao le os tres e deriva.
--
-- POR QUE NAO USAR SO `companies.industry`: ele e grosso demais e para a COHAPM esta
-- incompleto. Diz "Cooperativa habitacional", que descreve La Felicità e NAO descreve nem o
-- Juridico nem o Sistema Ocular — as tres marcas dividem um company_id, contaminacao ja
-- registrada no espelho dos crons. Derivar so pelo `industry` deixaria o Juridico sem as
-- regras juridicas.
--
-- A ARMADILHA, MEDIDA ANTES DE ESCREVER: o padrao ingenuo `(consignado|credito|emprestimo)`
-- classifica a COHAPM como CREDITO, porque `linhas_produto` dela tem "emprestimo_abusivo" e
-- "cobranca_indevida". Esses sao temas de LITIGIO sobre emprestimo, nao oferta de emprestimo —
-- quem processa banco por juros abusivos nao esta vendendo credito. Com o padrao ingenuo a
-- COHAPM continuaria recebendo FIN-04 e o falso positivo do Sistema Ocular sobreviveria a
-- esta migration inteira. Por isso o padrao exige sinal de OFERTA (`consignado`,
-- `credito clt`, `correspondente bancario`, `financiamento`) e nao a palavra "emprestimo"
-- solta. Conferido nas 3 empresas: ingenuo erra a COHAPM, o de oferta acerta as 3.
create or replace function public.ramos_da_empresa(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nome     text;
  v_industry text;
  v_marcas   text;
  v_sinais   text;
  v_ramos    text[] := '{}';
begin
  if p_company_id is null then
    raise exception
      'ramos_da_empresa exige company_id. Sem empresa nao ha ramo, e devolver conjunto vazio equivaleria a dizer que nenhuma regra se aplica - que e liberar tudo.'
      using errcode = 'raise_exception';
  end if;

  select c.name, coalesce(c.industry,'')
    into v_nome, v_industry
    from public.companies c
   where c.id = p_company_id;

  if v_nome is null then
    raise exception
      'ramos_da_empresa: empresa % nao existe em public.companies. Isto e defeito de quem chamou, nao ausencia de ramo - recusando em vez de devolver conjunto vazio.',
      p_company_id
      using errcode = 'raise_exception';
  end if;

  select coalesce(string_agg(
           bi.marca_nome || ' ' || coalesce(bi.linhas_produto::text, ''), ' '), '')
    into v_marcas
    from public.brand_identity bi
   where bi.company_id = p_company_id
     and bi.vigente;

  v_sinais := lower(v_industry || ' ' || coalesce(v_marcas,''));

  -- Sinal de OFERTA de credito. NAO inclui "emprestimo" solto: ver comentario acima.
  -- array_append e nao `|| 'credito'`: com array vazio o operador `||` resolve para
  -- `anyarray || anyarray` e o Postgres tenta ler a string como LITERAL DE ARRAY, estourando
  -- com "malformed array literal". Defeito que a primeira execucao da funcao acusou.
  if v_sinais ~ '(consignado|cr[eé]dito clt|correspondente banc|financiament|cr[eé]dito pessoal)' then
    v_ramos := array_append(v_ramos, 'credito');
  end if;

  if v_sinais ~ '(jur[ií]dic|advocat|advogad)' then
    v_ramos := array_append(v_ramos, 'juridico');
  end if;

  -- Empresa que e os dois ramos recebe os dois conjuntos: o array acumula, nao escolhe.
  if array_length(v_ramos, 1) is null then
    -- FAIL-CLOSED. Ramo nao derivavel NAO significa "nenhuma regra se aplica" - significa que
    -- nao sabemos estreitar, e nao saber estreitar obriga a manter tudo. O caminho oposto
    -- (conjunto vazio) seria o sexto fail-open deste projeto: empresa nova entraria no ar sem
    -- nenhuma regra de compliance e o portao devolveria "sem violacao detectada" com
    -- aparencia de normalidade.
    return jsonb_build_object(
      'ramos', jsonb_build_array('credito', 'juridico'),
      'resolvido', false,
      'origem', 'nao_derivavel_conjunto_mais_amplo',
      'empresa', v_nome,
      'sinais_lidos', nullif(btrim(v_sinais), ''),
      'como_ler', 'O ramo desta empresa NAO foi derivado, entao ela recebe TODAS as regras em vez de nenhuma. Isso pode gerar aviso fora de contexto - o conserto e declarar industry ou linhas_produto, nunca estreitar por omissao.');
  end if;

  return jsonb_build_object(
    'ramos', to_jsonb(v_ramos),
    'resolvido', true,
    'origem', 'companies.industry + brand_identity(marca_nome, linhas_produto)',
    'empresa', v_nome,
    'sinais_lidos', nullif(btrim(v_sinais), ''),
    'como_ler', 'Regras de ramo "qualquer" valem sempre e somam-se a estas.');
end;
$function$;

comment on function public.ramos_da_empresa(uuid) is
  'Deriva o ramo do negocio para escopar regras do portao de compliance. Nunca devolve conjunto vazio: empresa sem ramo derivavel recebe o conjunto MAIS AMPLO (todas as regras), e company_id nulo ou inexistente levanta excecao. Estreitar por omissao seria aprovar por omissao.';

-- =========================================================================================
-- 3. O PORTAO CIENTE DA EMPRESA
-- =========================================================================================
-- Mesma forma de retorno da versao global, para nao quebrar quem le. Acrescenta
-- `ramos_aplicados` e `escopo_resolvido` porque veredito escopado sem dizer QUAL escopo usou e
-- irrevisavel: quem le precisa poder distinguir "nao violou" de "nao foi medido contra esta
-- familia de regra".
create or replace function public.checar_promessas_proibidas_da_empresa(
  p_company_id uuid,
  p_texto      text
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_escopo    jsonb;
  v_ramos     text[];
  v_ativas    integer;
  v_bloqueios jsonb;
  v_atencoes  jsonb;
begin
  -- O escopo e resolvido ANTES do atalho de texto vazio, de proposito: company_id invalido
  -- deve estourar mesmo quando nao ha texto, senao o defeito do chamador fica escondido
  -- atras de toda peca sem legenda.
  v_escopo := public.ramos_da_empresa(p_company_id);

  select array_agg(r) into v_ramos
    from jsonb_array_elements_text(v_escopo->'ramos') r;

  if coalesce(btrim(p_texto),'') = '' then
    return jsonb_build_object(
      'avaliado', false,
      'bloqueia', false,
      'motivo', 'texto vazio - nao ha o que avaliar',
      'escopo', v_escopo,
      'nota', 'Ausencia de texto NAO e aprovacao: nao houve avaliacao.');
  end if;

  select count(*) into v_ativas
    from public.promessas_proibidas pp
   where pp.active
     and (pp.ramo = 'qualquer' or pp.ramo = any(v_ramos));

  if v_ativas = 0 then
    raise exception
      'portao de compliance vazio para a empresa % (ramos %): nenhuma regra ativa cobre este escopo, entao qualquer texto passaria. Recusando avaliar em vez de aprovar por omissao.',
      p_company_id, v_ramos
      using errcode = 'raise_exception';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'proibido', pp.proibido, 'seguro', pp.seguro,
           'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
           'ramo', pp.ramo,
           'observacao', pp.observacao)), '[]'::jsonb)
    into v_bloqueios
    from public.promessas_proibidas pp
   where pp.active and pp.severidade = 'bloqueia'
     and (pp.ramo = 'qualquer' or pp.ramo = any(v_ramos))
     and p_texto ~* pp.padrao
     and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de);

  select coalesce(jsonb_agg(jsonb_build_object(
           'proibido', pp.proibido, 'seguro', pp.seguro,
           'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
           'ramo', pp.ramo,
           'observacao', pp.observacao)), '[]'::jsonb)
    into v_atencoes
    from public.promessas_proibidas pp
   where pp.active and pp.severidade = 'atencao'
     and (pp.ramo = 'qualquer' or pp.ramo = any(v_ramos))
     and p_texto ~* pp.padrao
     and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de);

  return jsonb_build_object(
    'avaliado', true,
    'bloqueia', jsonb_array_length(v_bloqueios) > 0,
    'regras_consideradas', v_ativas,
    'ramos_aplicados', to_jsonb(v_ramos),
    'escopo_resolvido', coalesce((v_escopo->>'resolvido')::boolean, false),
    'escopo', v_escopo,
    'bloqueios', v_bloqueios,
    'atencoes', v_atencoes,
    'nota', 'Este e o mapa de SUBSTITUICAO por frase, agora escopado por ramo do negocio. Ausencia de casamento NAO e aprovacao, e regra de outro ramo nao foi avaliada - nao foi absolvida.');
end;
$function$;

-- =========================================================================================
-- 4. A EMISSAO PASSA A USAR O PORTAO ESCOPADO
-- =========================================================================================
-- `checar_par_texto_e_peca` ja recebe company_id e ja o exige (levanta excecao se for nulo),
-- entao a troca e direta e nao ha caminho por onde chegar sem empresa. Corpo identico ao
-- vigente, exceto as tres chamadas ao portao e dois campos novos no retorno.
create or replace function public.checar_par_texto_e_peca(
  p_company_id uuid,
  p_legenda text,
  p_drive_file_id text
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nome text; v_base text; v_mime text;
  v_texto_visivel text; v_motivo text; v_transcricao text; v_fonte text;
  v_estado_audio text;
  v_numeros text;
  v_texto_peca text := '';
  v_par text;
  v_res_legenda jsonb; v_res_peca jsonb; v_res_par jsonb;
  v_tem_peca boolean := false;
begin
  if p_company_id is null then
    raise exception 'checar_par_texto_e_peca exige p_company_id';
  end if;

  if p_drive_file_id is not null then
    select nome, base_da_analise, mime, texto_visivel, motivo, transcricao_audio, transcricao_fonte
      into v_nome, v_base, v_mime, v_texto_visivel, v_motivo, v_transcricao, v_fonte
      from public.drive_midia_analises
     where drive_file_id = p_drive_file_id and company_id = p_company_id
     order by (base_da_analise like '%criterio%') desc, analisado_em desc
     limit 1;
    v_tem_peca := found;
  end if;

  v_estado_audio := public.estado_do_audio_da_peca(v_transcricao, v_fonte, v_mime);

  v_numeros := substring(coalesce(v_motivo,'') from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*');

  if v_tem_peca then
    v_texto_peca := coalesce(v_texto_visivel,'') || ' ' || coalesce(v_numeros,'')
                 || ' ' || coalesce(v_transcricao,'');
  end if;

  v_par := coalesce(p_legenda,'') || ' ' || v_texto_peca;

  v_res_legenda := public.checar_promessas_proibidas_da_empresa(p_company_id, p_legenda);
  v_res_peca    := public.checar_promessas_proibidas_da_empresa(p_company_id, nullif(btrim(v_texto_peca),''));
  v_res_par     := public.checar_promessas_proibidas_da_empresa(p_company_id, nullif(btrim(v_par),''));

  return jsonb_build_object(
    'veredito', case
        when jsonb_array_length(coalesce(v_res_par->'bloqueios','[]'::jsonb)) > 0 then 'reprova'
        when jsonb_array_length(coalesce(v_res_par->'atencoes','[]'::jsonb)) > 0 then 'atencao'
        when not coalesce((v_res_par->>'avaliado')::boolean, false) then 'nada_a_avaliar'
        else 'sem_violacao_detectada' end,
    'PAR', v_res_par,
    'so_a_legenda', v_res_legenda,
    'so_a_peca', v_res_peca,
    -- Escopo no topo do retorno porque o consumidor precisa poder ler "contra o que fui
    -- medido" sem escavar o objeto PAR.
    'escopo_de_regras', v_res_par->'escopo',
    'peca', case when not v_tem_peca then null else jsonb_build_object(
        'nome', v_nome, 'base_da_analise', v_base, 'mime', v_mime,
        'caracteres_de_texto_na_tela', length(coalesce(v_texto_visivel,'')),
        'numeros_extraidos', v_numeros,
        'estado_do_audio', nullif(v_estado_audio, 'nao_se_aplica')) end,
    'cobertura', jsonb_build_object(
        'legenda_lida', (coalesce(btrim(p_legenda),'') <> ''),
        'texto_da_peca_lido', (v_tem_peca and coalesce(v_texto_visivel,'') <> ''),
        -- audio_lido significa "a fala foi avaliada", e video sem locucao conta como
        -- avaliado: era o defeito que punha os 5 Reels sem fala no balde de lacuna.
        'audio_lido', (v_tem_peca and public.audio_conferido(v_transcricao, v_fonte, v_mime)),
        'peca_encontrada', v_tem_peca,
        'escopo_de_ramo_resolvido', coalesce((v_res_par->>'escopo_resolvido')::boolean, false)),
    'lacunas', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'AUDIO NAO LIDO: nao ha transcricao para esta peca, entao o que e FALADO no video nao foi avaliado por ninguem. Isto nao e ausencia de risco.' as l
         where v_tem_peca and v_estado_audio = 'nao_avaliado'
        union all
        select 'AUDIO INACESSIVEL: a extracao de audio desta peca falhou (arquivo sem faixa de audio extraivel, ou acima do teto do transcritor), entao a fala tambem nao foi avaliada. Isto e diferente de video sem locucao.'
         where v_tem_peca and v_estado_audio = 'falha_tecnica'
        union all
        select 'PECA NAO ENCONTRADA nesta empresa: so a legenda foi avaliada. Ausencia de leitura da peca nao e aprovacao da peca.'
         where p_drive_file_id is not null and not v_tem_peca
        union all
        select 'NENHUMA PECA INFORMADA: este veredito cobre so o texto.'
         where p_drive_file_id is null
        union all
        select 'A peca nao tem texto visivel registrado: pode ser peca sem texto, ou leitura que nao capturou. As duas coisas parecem iguais aqui.'
         where v_tem_peca and coalesce(v_texto_visivel,'') = ''
        union all
        -- Lacuna nova: escopo nao resolvido e cobertura AMPLA DEMAIS, nao estreita. O aviso
        -- existe para que aviso fora de contexto seja lido como escopo faltando, e nao como
        -- regra mal escrita - foi o que quase me fez culpar a regra em vez do cadastro.
        select 'RAMO DA EMPRESA NAO DERIVADO: esta empresa nao declara industry nem linhas_produto reconheciveis, entao foi medida contra TODAS as regras, inclusive de outros ramos. Aviso fora de contexto aqui indica cadastro incompleto, nao regra errada.'
         where not coalesce((v_res_par->>'escopo_resolvido')::boolean, true)
      ) z),
    -- Conferido-e-sem-fala NAO entra em 'lacunas' de proposito: e cobertura completa, e
    -- listar como lacuna faria o emissor do card declarar falta que nao existe.
    'audio_sem_fala', case when v_estado_audio = 'sem_fala'
        then 'AUDIO CONFERIDO E SEM FALA: o transcritor rodou nesta peca e nao ha locucao (video so com texto na tela). A cobertura de audio esta completa aqui - nao ha lacuna a declarar.'
        else null end,
    'como_ler', 'O veredito vale sobre a CONCATENACAO de legenda + peca, porque regra condicional muda de resposta conforme o conjunto: citar taxa sem CET viola, mas se o CET estiver na legenda e o numero na peca, o par esta conforme. Por isso so_a_legenda e so_a_peca sao informativos - quem decide e PAR. As regras consideradas sao as do ramo desta empresa mais as de ramo "qualquer"; ver escopo_de_regras.',
    'nao_e_aprovacao', 'Deteccao por padrao de texto sobre a evidencia existente. O verificador por LLM continua sendo o principal, e ausencia de casamento aqui NAO e aprovacao.'
  );
end;
$function$;

-- =========================================================================================
-- 5. O CONTROLE PERMANENTE APRENDE A COBRAR O ESCOPO
-- =========================================================================================
-- Sem isto, o escopo por ramo seria um jeito novo de o portao morrer em silencio: bastaria a
-- derivacao passar a devolver vazio para tudo passar, e nada acusaria. Tres controles novos,
-- cada um cobrindo uma forma diferente de o escopo apodrecer.
create or replace function public.provar_portao_de_compliance()
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  c_positivo constant text := 'Credito garantido, sem consulta ao SPC, dinheiro rapido na conta.';
  c_negativo constant text := 'Conheca nosso empreendimento na regiao central e agende uma visita.';
  c_juridico constant text := 'Se voce tem 65 anos e nao se aposentou, saiba que voce tem direito a uma aposentadoria. Faca sua analise juridica gratuita com nosso advogado.';
  v_pos jsonb;
  v_neg jsonb;
  v_emp_credito  uuid;
  v_emp_juridico uuid;
  v_sem_ramo     uuid;
  v_r_credito  jsonb;
  v_r_juridico jsonb;
  v_r_sem_ramo jsonb;
  v_fantasma   uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_estourou   boolean := false;
begin
  v_pos := public.checar_promessas_proibidas(c_positivo);
  v_neg := public.checar_promessas_proibidas(c_negativo);

  if not coalesce((v_pos->>'bloqueia')::boolean, false) then
    raise exception
      'PORTAO DE COMPLIANCE MORTO: o controle positivo (%) NAO foi barrado. Regras ativas no momento: %. Um portao que nao barra o obvio aprova tudo.',
      c_positivo, coalesce(v_pos->>'regras_consideradas','?')
      using errcode = 'raise_exception';
  end if;

  if coalesce((v_neg->>'bloqueia')::boolean, false) then
    raise exception
      'PORTAO DE COMPLIANCE HISTERICO: o controle negativo (%) foi barrado. Regra larga demais trava a operacao e acaba desligada por quem tem pressa. Bloqueios acusados: %.',
      c_negativo, v_neg->'bloqueios'
      using errcode = 'raise_exception';
  end if;

  -- CONTROLE 3: o escopo por ramo esta discriminando de verdade? Uma empresa de credito tem
  -- de barrar o texto de credito; uma empresa juridica NAO deve ser medida contra ele. Se as
  -- duas responderem igual, o escopo virou enfeite e ninguem notaria.
  select id into v_emp_credito  from public.companies
   where (public.ramos_da_empresa(id)->'ramos') ? 'credito'
     and coalesce((public.ramos_da_empresa(id)->>'resolvido')::boolean,false)
     and not ((public.ramos_da_empresa(id)->'ramos') ? 'juridico') limit 1;

  select id into v_emp_juridico from public.companies
   where (public.ramos_da_empresa(id)->'ramos') ? 'juridico'
     and coalesce((public.ramos_da_empresa(id)->>'resolvido')::boolean,false)
     and not ((public.ramos_da_empresa(id)->'ramos') ? 'credito') limit 1;

  if v_emp_credito is not null and v_emp_juridico is not null then
    v_r_credito  := public.checar_promessas_proibidas_da_empresa(v_emp_credito,  c_positivo);
    v_r_juridico := public.checar_promessas_proibidas_da_empresa(v_emp_juridico, c_positivo);

    if not coalesce((v_r_credito->>'bloqueia')::boolean, false) then
      raise exception
        'ESCOPO DE RAMO QUEBRADO: a empresa de credito % nao barrou o texto de credito (%). O escopo esta escondendo regra de quem deveria receber, que e pior que nao ter escopo.',
        v_emp_credito, c_positivo
        using errcode = 'raise_exception';
    end if;

    if coalesce((v_r_juridico->>'bloqueia')::boolean, false) then
      raise exception
        'ESCOPO DE RAMO INERTE: a empresa juridica % foi barrada por regra de credito. O escopo nao esta filtrando nada - era exatamente o falso positivo que esta migration existe para corrigir.',
        v_emp_juridico
        using errcode = 'raise_exception';
    end if;

    -- E o inverso: a empresa juridica tem de ver a regra juridica.
    if jsonb_array_length(
         coalesce(public.checar_promessas_proibidas_da_empresa(v_emp_juridico, c_juridico)->'bloqueios','[]'::jsonb)
       ) + jsonb_array_length(
         coalesce(public.checar_promessas_proibidas_da_empresa(v_emp_juridico, c_juridico)->'atencoes','[]'::jsonb)
       ) = 0 then
      raise exception
        'ESCOPO DE RAMO CEGO: a empresa juridica % nao acusou nada no texto juridico de controle. As regras LGL-JUR nao estao alcancando quem elas existem para cobrir.',
        v_emp_juridico
        using errcode = 'raise_exception';
    end if;
  end if;

  -- CONTROLE 4: empresa sem ramo derivavel cai no conjunto MAIS AMPLO, nunca no vazio.
  select id into v_sem_ramo from public.companies
   where not coalesce((public.ramos_da_empresa(id)->>'resolvido')::boolean, true) limit 1;

  if v_sem_ramo is not null then
    v_r_sem_ramo := public.checar_promessas_proibidas_da_empresa(v_sem_ramo, c_positivo);
    if not coalesce((v_r_sem_ramo->>'bloqueia')::boolean, false) then
      raise exception
        'FAIL-OPEN POR AUSENCIA DE RAMO: a empresa % nao tem ramo derivavel e NAO barrou o controle positivo. Empresa sem ramo tem de receber todas as regras; passar limpa e o pior desfecho possivel.',
        v_sem_ramo
        using errcode = 'raise_exception';
    end if;
  end if;

  -- CONTROLE 5: company_id inexistente tem de ESTOURAR, nao devolver veredito. Um uuid que
  -- nao esta em `companies` e defeito de chamador; responder "sem violacao" a ele seria
  -- exatamente a leitura frouxa que originou esta linha de trabalho.
  begin
    perform public.checar_promessas_proibidas_da_empresa(v_fantasma, c_positivo);
  exception when others then
    v_estourou := true;
  end;

  if not v_estourou then
    raise exception
      'PORTAO ACEITA EMPRESA INEXISTENTE: checar_promessas_proibidas_da_empresa(%) devolveu veredito em vez de estourar. Empresa que nao existe nao pode receber aprovacao.',
      v_fantasma
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object(
    'portao', 'vivo',
    'regras_ativas', (v_pos->>'regras_consideradas')::int,
    'controle_positivo_barrado', true,
    'controle_negativo_liberado', true,
    'bloqueios_no_positivo', jsonb_array_length(v_pos->'bloqueios'),
    'escopo_por_ramo', jsonb_build_object(
      'empresa_credito_testada', v_emp_credito,
      'empresa_juridica_testada', v_emp_juridico,
      'empresa_sem_ramo_testada', v_sem_ramo,
      'credito_barra_texto_de_credito', v_emp_credito is not null,
      'juridica_ignora_texto_de_credito', v_emp_juridico is not null,
      'sem_ramo_cai_no_conjunto_amplo', v_sem_ramo is not null,
      'empresa_inexistente_estoura', true),
    'como_ler', 'Esta funcao levanta excecao quando o portao esta morto, histerico, ou quando o escopo por ramo para de discriminar. Retorno bem-sucedido e a prova; nao ha veredito silencioso.');
end;
$function$;
