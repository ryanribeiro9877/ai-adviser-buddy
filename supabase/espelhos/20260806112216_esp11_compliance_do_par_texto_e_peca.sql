-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806112216
-- name: esp11_compliance_do_par_texto_e_peca
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-11 · compliance do PAR legenda + peca. E ESP-12 (parte do banco): o lugar da transcricao.
--
-- A LACUNA QUE ISTO FECHA, declarada em toda mensagem do sistema desde 04/08: ninguem avaliava
-- o PAR. O verificador le a legenda; o que a peca MOSTRA na tela ficava fora. Foi assim que 5
-- videos exibindo valor, parcela e prazo sem CET chegaram a biblioteca da Meta liberados.
--
-- POR QUE AVALIAR A CONCATENACAO E NAO A SOMA DAS PARTES: as regras condicionais mudam de
-- veredito conforme o conjunto. FIN-04 so viola se o texto citar numero E NAO contiver "CET".
-- Se a legenda traz o CET e a peca mostra os numeros, o PAR esta conforme. Se nenhum dos dois
-- traz, o par viola - ainda que cada metade isolada passe. Somar veredito de partes daria a
-- resposta errada nos dois sentidos.
--
-- O QUE ESTA FUNCAO NAO E: nao e o verificador de compliance. Ela detecta a classe de problema
-- que da para detectar por texto, sobre a evidencia que existe. O gate por LLM continua sendo
-- o principal, e ausencia de casamento aqui NAO e aprovacao.
--
-- COBERTURA DECLARADA, sempre: legenda (sim), texto visivel da peca (sim, com a base e quantos
-- caracteres), AUDIO (nao, ate a transcricao existir). Prometer avaliacao do par sem dizer que
-- o audio ficou de fora seria trocar uma lacuna declarada por uma garantia falsa - que e pior.

-- ESP-12, parte do banco: o slot da transcricao. Nasce vazio; quem preenche e a edge.
alter table public.drive_midia_analises
  add column if not exists transcricao_audio text,
  add column if not exists transcricao_em timestamptz,
  add column if not exists transcricao_fonte text;

comment on column public.drive_midia_analises.transcricao_audio is
  'ESP-12: fala do video transcrita. NULO = nao transcrito (nao e "sem fala"). Preenchido pela edge transcribe-audio, que tem teto de 15MB - videos acima ficam sem transcricao e a lacuna e declarada.';
comment on column public.drive_midia_analises.transcricao_em is
  'Quando a transcricao foi feita. NULO com transcricao_audio NULO = nunca tentado.';

create or replace function public.checar_par_texto_e_peca(
  p_company_id uuid,
  p_legenda text,
  p_drive_file_id text
)
returns jsonb
language plpgsql
stable
as $$
declare
  pe record;
  v_texto_peca text := '';
  v_par text;
  v_res_legenda jsonb; v_res_peca jsonb; v_res_par jsonb;
  v_tem_peca boolean := false;
begin
  if p_company_id is null then
    raise exception 'checar_par_texto_e_peca exige p_company_id';
  end if;

  if p_drive_file_id is not null then
    select texto_visivel, motivo, base_da_analise, nome,
           transcricao_audio, transcricao_em, mime
      into pe
      from public.drive_midia_analises
     where drive_file_id = p_drive_file_id and company_id = p_company_id
     order by (base_da_analise like '%criterio%') desc, analisado_em desc
     limit 1;
    v_tem_peca := found;
  end if;

  if v_tem_peca then
    -- o texto da peca e o que a leitura VIU na tela mais os numeros que ela extraiu,
    -- mais a fala quando existir transcricao.
    v_texto_peca := coalesce(pe.texto_visivel,'')
      || ' ' || coalesce(substring(pe.motivo from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*'), '')
      || ' ' || coalesce(pe.transcricao_audio,'');
  end if;

  v_par := coalesce(p_legenda,'') || ' ' || v_texto_peca;

  v_res_legenda := public.checar_promessas_proibidas(p_legenda);
  v_res_peca    := public.checar_promessas_proibidas(nullif(btrim(v_texto_peca),''));
  v_res_par     := public.checar_promessas_proibidas(nullif(btrim(v_par),''));

  return jsonb_build_object(
    'veredito', case
        when jsonb_array_length(coalesce(v_res_par->'bloqueios','[]'::jsonb)) > 0 then 'reprova'
        when jsonb_array_length(coalesce(v_res_par->'atencoes','[]'::jsonb)) > 0 then 'atencao'
        when not (v_res_par->>'avaliado')::boolean then 'nada_a_avaliar'
        else 'sem_violacao_detectada' end,
    'PAR', v_res_par,
    'so_a_legenda', v_res_legenda,
    'so_a_peca', v_res_peca,
    'peca', case when not v_tem_peca then null else jsonb_build_object(
        'nome', pe.nome, 'base_da_analise', pe.base_da_analise, 'mime', pe.mime,
        'caracteres_de_texto_na_tela', length(coalesce(pe.texto_visivel,'')),
        'numeros_extraidos', substring(pe.motivo from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*')) end,
    'cobertura', jsonb_build_object(
        'legenda_lida', (coalesce(btrim(p_legenda),'') <> ''),
        'texto_da_peca_lido', v_tem_peca and coalesce(pe.texto_visivel,'') <> '',
        'audio_lido', v_tem_peca and coalesce(pe.transcricao_audio,'') <> '',
        'peca_encontrada', v_tem_peca),
    'lacunas', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'AUDIO NAO LIDO: nenhuma transcricao existe para esta peca, entao o que e FALADO no video nao foi avaliado por ninguem. Isto nao e ausencia de risco.' as l
         where v_tem_peca and coalesce(pe.transcricao_audio,'') = '' and coalesce(pe.mime,'') like 'video%'
        union all
        select 'PECA NAO ENCONTRADA nesta empresa: so a legenda foi avaliada. Ausencia de leitura da peca nao e aprovacao da peca.'
         where p_drive_file_id is not null and not v_tem_peca
        union all
        select 'NENHUMA PECA INFORMADA: este veredito cobre so o texto.'
         where p_drive_file_id is null
        union all
        select 'A peca nao tem texto visivel registrado: pode ser peca sem texto, ou leitura que nao capturou. As duas coisas parecem iguais aqui.'
         where v_tem_peca and coalesce(pe.texto_visivel,'') = ''
      ) z),
    'como_ler', 'O veredito vale sobre a CONCATENACAO de legenda + peca, porque regra condicional muda de resposta conforme o conjunto: citar taxa sem CET viola, mas se o CET estiver na legenda e o numero na peca, o par esta conforme. Por isso so_a_legenda e so_a_peca sao informativos - quem decide e PAR.',
    'nao_e_aprovacao', 'Deteccao por padrao de texto sobre a evidencia existente. O verificador por LLM continua sendo o principal, e ausencia de casamento aqui NAO e aprovacao.'
  );
end;
$$;

comment on function public.checar_par_texto_e_peca(uuid, text, text) is
  'ESP-11: avalia legenda + peca JUNTAS, sobre a concatenacao, e declara cobertura e lacunas - inclusive que o audio nao foi lido enquanto nao houver transcricao.';