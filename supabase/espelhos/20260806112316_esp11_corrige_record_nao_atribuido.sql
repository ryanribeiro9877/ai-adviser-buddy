-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806112316
-- name: esp11_corrige_record_nao_atribuido
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-11 correcao · defeito meu, pego pelo teste sem peca.
--
-- CAUSA: quando p_drive_file_id e NULO o "select into pe" nunca executa, e o registro fica
-- NAO-ATRIBUIDO. Em PL/pgSQL, referenciar pe.nome nessa situacao levanta erro 55000 AINDA QUE
-- dentro de um "case when not v_tem_peca then null" - a estrutura da tupla precisa existir para
-- a expressao ser compilada, e o case nao protege. Irmao da armadilha do RECORD IS NOT NULL:
-- registro nao se comporta como valor anulavel.
--
-- CONSERTO: extrair os campos para variaveis escalares logo apos o select. Escalar nao
-- atribuido e simplesmente NULL, e NULL se comporta como se espera.

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
  v_nome text; v_base text; v_mime text;
  v_texto_visivel text; v_motivo text; v_transcricao text;
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
    select nome, base_da_analise, mime, texto_visivel, motivo, transcricao_audio
      into v_nome, v_base, v_mime, v_texto_visivel, v_motivo, v_transcricao
      from public.drive_midia_analises
     where drive_file_id = p_drive_file_id and company_id = p_company_id
     order by (base_da_analise like '%criterio%') desc, analisado_em desc
     limit 1;
    v_tem_peca := found;
  end if;

  v_numeros := substring(coalesce(v_motivo,'') from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*');

  if v_tem_peca then
    v_texto_peca := coalesce(v_texto_visivel,'') || ' ' || coalesce(v_numeros,'')
                 || ' ' || coalesce(v_transcricao,'');
  end if;

  v_par := coalesce(p_legenda,'') || ' ' || v_texto_peca;

  v_res_legenda := public.checar_promessas_proibidas(p_legenda);
  v_res_peca    := public.checar_promessas_proibidas(nullif(btrim(v_texto_peca),''));
  v_res_par     := public.checar_promessas_proibidas(nullif(btrim(v_par),''));

  return jsonb_build_object(
    'veredito', case
        when jsonb_array_length(coalesce(v_res_par->'bloqueios','[]'::jsonb)) > 0 then 'reprova'
        when jsonb_array_length(coalesce(v_res_par->'atencoes','[]'::jsonb)) > 0 then 'atencao'
        when not coalesce((v_res_par->>'avaliado')::boolean, false) then 'nada_a_avaliar'
        else 'sem_violacao_detectada' end,
    'PAR', v_res_par,
    'so_a_legenda', v_res_legenda,
    'so_a_peca', v_res_peca,
    'peca', case when not v_tem_peca then null else jsonb_build_object(
        'nome', v_nome, 'base_da_analise', v_base, 'mime', v_mime,
        'caracteres_de_texto_na_tela', length(coalesce(v_texto_visivel,'')),
        'numeros_extraidos', v_numeros) end,
    'cobertura', jsonb_build_object(
        'legenda_lida', (coalesce(btrim(p_legenda),'') <> ''),
        'texto_da_peca_lido', (v_tem_peca and coalesce(v_texto_visivel,'') <> ''),
        'audio_lido', (v_tem_peca and coalesce(v_transcricao,'') <> ''),
        'peca_encontrada', v_tem_peca),
    'lacunas', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'AUDIO NAO LIDO: nao ha transcricao para esta peca, entao o que e FALADO no video nao foi avaliado por ninguem. Isto nao e ausencia de risco.' as l
         where v_tem_peca and coalesce(v_transcricao,'') = '' and coalesce(v_mime,'') like 'video%'
        union all
        select 'PECA NAO ENCONTRADA nesta empresa: so a legenda foi avaliada. Ausencia de leitura da peca nao e aprovacao da peca.'
         where p_drive_file_id is not null and not v_tem_peca
        union all
        select 'NENHUMA PECA INFORMADA: este veredito cobre so o texto.'
         where p_drive_file_id is null
        union all
        select 'A peca nao tem texto visivel registrado: pode ser peca sem texto, ou leitura que nao capturou. As duas coisas parecem iguais aqui.'
         where v_tem_peca and coalesce(v_texto_visivel,'') = ''
      ) z),
    'como_ler', 'O veredito vale sobre a CONCATENACAO de legenda + peca, porque regra condicional muda de resposta conforme o conjunto: citar taxa sem CET viola, mas se o CET estiver na legenda e o numero na peca, o par esta conforme. Por isso so_a_legenda e so_a_peca sao informativos - quem decide e PAR.',
    'nao_e_aprovacao', 'Deteccao por padrao de texto sobre a evidencia existente. O verificador por LLM continua sendo o principal, e ausencia de casamento aqui NAO e aprovacao.'
  );
end;
$$;