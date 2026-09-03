-- A linha de produto passa a ser reconhecida no nome real das campanhas.
--
-- Achado: o resolvedor lia SO o token entre colchetes do inicio do nome ([LEV], [LAF]),
-- que e a convencao documentada em _shared/nomenclatura.ts. Nenhuma das 6 campanhas
-- ativas usa essa convencao. Os nomes reais sao:
--
--   COHAPM_JURIDICO_CONV_WA_2026-08
--   COHAPM_LAFELICITA_CONV_WA_2026-08
--   COHAPM_VISTTA_CONV_WA_SET26
--   Publicacao do Instagram: ... (3)
--
-- Resultado: o alerta de cobertura saiu com "linha nao identificada pelo nome da
-- campanha" para todas. A protecao contra contaminacao entre linhas -- que o gestor
-- classificou como erro grave -- estava, na pratica, desligada nos dados reais. O
-- resolvedor nao mentia (ele declarava que nao sabia, que e o comportamento certo), mas
-- tambem nao servia.
--
-- A armadilha que torna isso mais delicado do que parece: COHAPM prefixa os nomes das
-- TRES marcas, porque e o nome da conta, nao da marca. Casar "primeira tag encontrada"
-- arquivaria La Felicita e VISTTA como COHAPM Juridico -- ou seja, produziria exatamente
-- a contaminacao que a funcao existe para evitar. Errar aqui e pior que nao resolver.
--
-- Regra adotada, em tres camadas:
--
-- 1. Token entre colchetes continua tendo precedencia. A convencao documentada nao e
--    abandonada; quem seguir ela e atendido primeiro.
--
-- 2. Sem colchete, casa-se o `marca_nome` normalizado (sem acento, sem separador) e a
--    `marca_tag` DELIMITADA. A delimitacao e obrigatoria para tag porque tag curta em
--    substring livre e uma fabrica de falso positivo: 'LEV' casaria dentro de "LEVE" ou
--    "RELEVANTE" e mandaria a campanha para Legal e Viver.
--
-- 3. Entre os candidatos, vence o casamento MAIS LONGO; empate vai para o que aparece
--    MAIS TARDE no nome. As duas regras juntas resolvem a armadilha do COHAPM:
--      COHAPM_JURIDICO   -> "COHAPMJURIDICO" (14) vence "COHAPM" (6)      -> COHAPM Juridico
--      COHAPM_LAFELICITA -> "LAFELICITA" (10) vence "COHAPM" (6)          -> La Felicita
--      COHAPM_VISTTA     -> empate 6 x 6, VISTTA aparece depois           -> Sistema Ocular
--    Nada casou? Devolve NULL, e quem chama diz que nao identificou. Continua sendo
--    melhor admitir do que chutar.

-- Normalizacao usada nas duas pontas: maiuscula, sem acento, so alfanumerico. Assim
-- "La Felicità" e "COHAPM_LAFELICITA_..." se encontram.
create or replace function public.normalizar_para_busca(p_texto text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select regexp_replace(
           translate(upper(coalesce(p_texto, '')),
                     'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                     'AAAAAEEEEIIIIOOOOOUUUUCN'),
           '[^A-Z0-9]', '', 'g')
$function$;

revoke all on function public.normalizar_para_busca(text) from public, anon, authenticated;
grant execute on function public.normalizar_para_busca(text) to service_role;

create or replace function public.linha_de_produto_do_nome(
  p_nome text,
  p_company_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_marca text;
  v_norm  text;
begin
  if p_nome is null or btrim(p_nome) = '' then
    return null;
  end if;

  -- Camada 1: a convencao documentada, [TAG] no inicio.
  v_token := upper(nullif(substring(p_nome from '^\s*\[([^\]]+)\]'), ''));
  if v_token is not null then
    select b.marca_nome into v_marca
      from public.brand_identity b
     where b.vigente
       and upper(b.marca_tag) = v_token
       and (p_company_id is null or b.company_id = p_company_id)
     limit 1;
    if v_marca is not null then
      return v_marca;
    end if;

    select b.marca_nome into v_marca
      from public.brand_identity b
     where b.vigente and upper(b.marca_tag) = v_token
     limit 1;
    if v_marca is not null then
      return v_marca;
    end if;

    return format('linha nao cadastrada (%s)', v_token);
  end if;

  -- Camadas 2 e 3: nome normalizado ou tag delimitada, mais longo e mais tarde vence.
  v_norm := public.normalizar_para_busca(p_nome);
  if v_norm = '' then
    return null;
  end if;

  select c.marca_nome into v_marca
    from (
      -- Candidato por nome da marca: seguro em substring livre, porque e longo.
      select b.marca_nome,
             length(public.normalizar_para_busca(b.marca_nome)) as forca,
             position(public.normalizar_para_busca(b.marca_nome) in v_norm) as onde
        from public.brand_identity b
       where b.vigente
         and (p_company_id is null or b.company_id = p_company_id)
         and public.normalizar_para_busca(b.marca_nome) <> ''
         and position(public.normalizar_para_busca(b.marca_nome) in v_norm) > 0

      union all

      -- Candidato por tag: exige delimitador no nome ORIGINAL. O filtro de tag
      -- alfanumerica evita que tag com metacaractere quebre a expressao regular.
      select b.marca_nome,
             length(b.marca_tag) as forca,
             position(upper(b.marca_tag) in v_norm) as onde
        from public.brand_identity b
       where b.vigente
         and (p_company_id is null or b.company_id = p_company_id)
         and coalesce(b.marca_tag, '') ~ '^[A-Za-z0-9]+$'
         and p_nome ~* ('(^|[^A-Za-z0-9])' || b.marca_tag || '([^A-Za-z0-9]|$)')
    ) c
   order by c.forca desc, c.onde desc
   limit 1;

  return v_marca;
end
$function$;

revoke all on function public.linha_de_produto_do_nome(text, uuid) from public, anon, authenticated;
grant execute on function public.linha_de_produto_do_nome(text, uuid) to service_role;
