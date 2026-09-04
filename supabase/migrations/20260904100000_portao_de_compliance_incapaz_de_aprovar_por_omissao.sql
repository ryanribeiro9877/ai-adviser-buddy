-- O PORTAO DE COMPLIANCE FICA INCAPAZ DE APROVAR POR OMISSAO
--
-- POR QUE, com o caso que originou o conserto. Na apuracao de 03/09/2026 eu comparei o risco
-- do audio contra o da tela lendo `resultado->>'aprovado'`. Essa chave NAO EXISTE no retorno
-- de `checar_promessas_proibidas`, que devolve `bloqueios`/`atencoes`. Toda comparacao deu
-- NULL, NULL virou "sem risco", e eu quase reportei "o audio nao carrega risco" com base em
-- nada. O que denunciou foi um CONTROLE POSITIVO - um texto que TINHA de ser barrado e nao
-- foi. E o primeiro controle positivo tambem falhou, por outro motivo: os padroes sao regex
-- sensiveis a ordem, e "garantimos a aprovacao" nao casa `aprovac...garantid`.
--
-- Este e o terceiro episodio do MESMO defeito neste projeto - ausencia de sinal lida como
-- aprovacao. Ja apareceu em `get_notificacoes_pendentes` (comparacao `status::text` que zerava
-- as aprovacoes em silencio) e na auditoria de 13/08 (10 de 12 funcoes deram 404 que era
-- `PGRST202`, argumento faltando, e nao permissao - o teste por HTTP "confirmou" um conserto
-- que era no-op). A licao repetida: **status ausente nao e status seguro**, e quem prova nao
-- e o resultado que voce esperava ver, e o controle que tinha de falhar.
--
-- TRES MUDANCAS, todas na direcao de tornar o silencio impossivel:
--
-- (1) PORTAO VAZIO PASSA A GRITAR. Se nao houver nenhuma regra ativa em
--     `promessas_proibidas`, a funcao levanta excecao em vez de devolver `bloqueios: []`.
--     Antes, desativar as 10 regras (ou apontar para um banco sem seed) produzia um portao
--     que aprovava tudo com aparencia de normalidade - e a unica evidencia seria alguem
--     desconfiar. Agora a emissao para e diz o motivo. Isto e deliberadamente um martelo:
--     preferimos operacao travada a operacao publicando sem portao.
--
-- (2) O RETORNO PASSA A TER RESPOSTA EM CHAVE PROPRIA. `bloqueia` (booleano) e
--     `regras_consideradas` (contagem). Um consumidor que le `bloqueia` recebe verdadeiro ou
--     falso; um consumidor que le uma chave inexistente recebe NULL e, se ele fizer
--     `not coalesce(...)`, cai no lado seguro em vez do lado livre. `regras_consideradas`
--     permite ao chamador conferir que o portao rodou de fato, e nao apenas nao reclamou.
--     As chaves antigas continuam todas, byte a byte, porque ha seis consumidores vivos.
--
-- (3) CONTROLE POSITIVO PERMANENTE. `provar_portao_de_compliance()` roda um texto que TEM de
--     ser barrado e um texto inocente que NAO pode ser, e levanta excecao se qualquer um dos
--     dois sair do esperado. Institucionaliza o metodo que descobriu o defeito: portao morto
--     passa a ser achado de teste, nao de desconfianca. `vigiar_portao_de_compliance()`
--     transforma a falha em alerta pela via que o resto do sistema ja usa.
--
-- O texto do controle positivo foi escolhido para casar TRES regras de familias diferentes
-- (credito garantido, sem consulta a SPC, dinheiro rapido). Um controle que dependesse de uma
-- regra so morreria junto com ela e daria falso "tudo bem".

create or replace function public.checar_promessas_proibidas(p_texto text)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ativas   integer;
  v_bloqueios jsonb;
  v_atencoes  jsonb;
begin
  -- Texto vazio nao consulta regra: nao ha o que avaliar, e isso NAO e aprovacao.
  if coalesce(btrim(p_texto),'') = '' then
    return jsonb_build_object(
      'avaliado', false,
      'bloqueia', false,
      'motivo', 'texto vazio - nao ha o que avaliar',
      'nota', 'Ausencia de texto NAO e aprovacao: nao houve avaliacao.');
  end if;

  select count(*) into v_ativas from public.promessas_proibidas where active;

  -- (1) portao vazio grita. Ver cabecalho: martelo deliberado.
  if v_ativas = 0 then
    raise exception
      'portao de compliance vazio: promessas_proibidas nao tem nenhuma regra ativa, '
      'entao qualquer texto passaria. Recusando avaliar em vez de aprovar por omissao.'
      using errcode = 'raise_exception';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'proibido', pp.proibido, 'seguro', pp.seguro,
           'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
           'observacao', pp.observacao)), '[]'::jsonb)
    into v_bloqueios
    from public.promessas_proibidas pp
   where pp.active and pp.severidade = 'bloqueia'
     and p_texto ~* pp.padrao
     and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de);

  select coalesce(jsonb_agg(jsonb_build_object(
           'proibido', pp.proibido, 'seguro', pp.seguro,
           'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
           'observacao', pp.observacao)), '[]'::jsonb)
    into v_atencoes
    from public.promessas_proibidas pp
   where pp.active and pp.severidade = 'atencao'
     and p_texto ~* pp.padrao
     and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de);

  return jsonb_build_object(
    'avaliado', true,
    -- (2) a resposta em chave propria. Quem le esta chave recebe booleano de verdade.
    'bloqueia', jsonb_array_length(v_bloqueios) > 0,
    'regras_consideradas', v_ativas,
    'bloqueios', v_bloqueios,
    'atencoes', v_atencoes,
    'nota', 'Este e o mapa de SUBSTITUICAO por frase. A deteccao principal continua no '
         || 'verificador de compliance; o padrao aqui e auxiliar e pode nao pegar variacao '
         || 'de escrita. Ausencia de casamento NAO e aprovacao.');
end;
$function$;

comment on function public.checar_promessas_proibidas(text) is
  'Mapa de substituicao por frase sobre promessas_proibidas. Devolve bloqueia (booleano), '
  'regras_consideradas, bloqueios e atencoes. Levanta excecao se nao houver regra ativa: '
  'portao vazio recusa avaliar em vez de aprovar por omissao. Ausencia de casamento NAO e '
  'aprovacao - use provar_portao_de_compliance() para confirmar que o portao esta vivo.';


-- (3) CONTROLE POSITIVO PERMANENTE.
--
-- Duas asserçoes, e as duas importam. O controle POSITIVO pega portao morto (regras
-- desativadas, padrao quebrado, seed ausente). O controle NEGATIVO pega portao histerico
-- (regra larga demais que barra texto inocente) - que e o outro jeito de o portao ficar
-- inutil, porque operacao que reprova tudo e desligada por quem esta com pressa.
create or replace function public.provar_portao_de_compliance()
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Casa TRES familias de regra de proposito: controle preso a uma regra so morre com ela.
  c_positivo constant text :=
    'Credito garantido, sem consulta ao SPC, dinheiro rapido na conta.';
  c_negativo constant text :=
    'Conheca nosso empreendimento na regiao central e agende uma visita.';
  v_pos jsonb;
  v_neg jsonb;
begin
  v_pos := public.checar_promessas_proibidas(c_positivo);
  v_neg := public.checar_promessas_proibidas(c_negativo);

  if not coalesce((v_pos->>'bloqueia')::boolean, false) then
    raise exception
      'PORTAO DE COMPLIANCE MORTO: o controle positivo (%) NAO foi barrado. '
      'Regras ativas no momento: %. Um portao que nao barra o obvio aprova tudo.',
      c_positivo, coalesce(v_pos->>'regras_consideradas','?')
      using errcode = 'raise_exception';
  end if;

  if coalesce((v_neg->>'bloqueia')::boolean, false) then
    raise exception
      'PORTAO DE COMPLIANCE HISTERICO: o controle negativo (%) foi barrado. '
      'Regra larga demais trava a operacao e acaba desligada por quem tem pressa. '
      'Bloqueios acusados: %.',
      c_negativo, v_neg->'bloqueios'
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object(
    'portao', 'vivo',
    'regras_ativas', (v_pos->>'regras_consideradas')::int,
    'controle_positivo_barrado', true,
    'controle_negativo_liberado', true,
    'bloqueios_no_positivo', jsonb_array_length(v_pos->'bloqueios'),
    'como_ler', 'Esta funcao levanta excecao quando o portao esta morto ou histerico. '
             || 'Retorno bem-sucedido e a prova; nao ha veredito silencioso.');
end;
$function$;

comment on function public.provar_portao_de_compliance() is
  'Controle positivo + negativo permanente do portao de compliance. Levanta excecao se o '
  'texto que TEM de ser barrado passa (portao morto) ou se o texto inocente e barrado '
  '(portao histerico). Nasceu em 04/09/2026: o defeito de ler chave inexistente como '
  'aprovacao foi descoberto por controle positivo manual, e este arquivo institucionaliza o '
  'metodo para que a proxima deteccao seja de teste, e nao de desconfianca.';


-- O vigia traduz a falha em alerta pela via que o resto do sistema ja usa, para que portao
-- morto apareca no sino do gestor e nao dependa de alguem rodar a prova a mao.
create or replace function public.vigiar_portao_de_compliance()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_prova jsonb;
  v_erro  text;
  v_emp   record;
  v_n     integer := 0;
begin
  begin
    v_prova := public.provar_portao_de_compliance();
  exception when others then
    v_erro := sqlerrm;
  end;

  if v_erro is null then
    return jsonb_build_object('ok', true, 'prova', v_prova);
  end if;

  -- O portao e global (promessas_proibidas nao tem company_id), mas `alerts.company_id` e
  -- NOT NULL: nao existe alerta sem dono. Entao o defeito global vira um alerta POR empresa,
  -- porque cada uma emite anuncio por conta propria e cada uma precisa ver que o portao caiu.
  -- A chave de dedupe leva o company_id para nao colapsar os dois em um.
  for v_emp in select id, name from public.companies loop
    perform public.emitir_alerta(
      p_company_id   => v_emp.id,
      p_severidade   => 'critical'::alert_severity,
      p_titulo       => 'Portao de compliance nao passou no proprio controle',
      p_o_que        => 'O controle permanente do portao de promessas proibidas falhou, '
                     || 'entao o veredito de compliance de texto NAO pode ser considerado '
                     || 'confiavel neste momento. Detalhe: ' || v_erro,
      p_onde         => 'public.checar_promessas_proibidas / public.promessas_proibidas',
      p_quanto       => v_erro,
      p_acao         => 'Rodar select public.provar_portao_de_compliance() e conferir as '
                     || 'regras ativas em promessas_proibidas. Enquanto nao passar, tratar '
                     || 'toda emissao de anuncio como NAO avaliada - nao como aprovada.',
      p_janela       => 'agora',
      p_tarefa       => 'vigiar_portao_de_compliance',
      p_chave_dedupe => 'portao_de_compliance_quebrado:' || v_emp.id::text
    );
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', false, 'erro', v_erro, 'alertas_emitidos', v_n);
end;
$function$;

comment on function public.vigiar_portao_de_compliance() is
  'Roda provar_portao_de_compliance() e, se falhar, emite alerta critico em vez de deixar a '
  'falha em silencio. Pensado para cron diario: portao morto e o tipo de defeito que nao '
  'aparece na operacao normal, porque tudo continua "passando".';
