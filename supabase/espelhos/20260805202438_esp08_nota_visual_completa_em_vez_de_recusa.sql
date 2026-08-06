-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805202438
-- name: esp08_nota_visual_completa_em_vez_de_recusa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-08 · REENQUADRADO. O card que eu escrevi mandava RECUSAR peca cujo veredito visual nao
-- bate com o produto declarado. Isso CONTRADIZ uma decisao vigente do gestor, e eu escrevi o
-- card sem ter lido o fato.
--
-- O FATO 46 (Roberto, 31/07/2026, vigente): "TODO o acervo esta LIBERADO por ordem dele -
-- inclusive os que a analise visual marcou como nao ou incerto. Ao recomendar peca liberada
-- cujo conteudo visual aparenta OUTRO produto, DECLARE a divergencia como nota ('liberada por
-- sua decisao de 31/07; o visual aparenta X) - NUNCA RECUSE, NUNCA ESCONDA."
-- Recusar seria o sistema sobrescrevendo decisao humana datada. Duas camadas, nunca sobrescrita.
--
-- O DEFEITO REAL, que existe e nao conflita com nada: a nota que o pedido_de_anuncio_completo
-- monta le riscos_compliance, produto_detectado e base_da_analise - e NAO le MOTIVO. No video
-- 19 (drive 1S1-xm_15WkTEOyv1nyCcQTCvdIaSSfu0) o riscos_compliance esta VAZIO e o motivo diz
-- "o conteudo parece tratar de credito empresarial (tempo de fundacao da empresa/CNPJ) e nao
-- de consignado CLT". Resultado hoje: a nota sai como "nenhum risco anotado, produto detectado
-- indeterminado" - verdadeira e inutil, porque omite justamente o que desqualifica a peca.
-- ESCALA: 18 das 67 pecas tem produto vigente fora do universo da marca; 2 delas tem risco
-- vazio com motivo cheio.
--
-- Esta funcao IMPLEMENTA a instrucao do gestor em vez de sobrescreve-la: declara a divergencia,
-- com o motivo, citando a decisao dele, e dizendo explicitamente que nao recusa.
--
-- UNIVERSO DA MARCA transcrito do fato 46: credito CLT + educacao financeira + seguranca
-- financeira. Se o gestor mudar o universo, esta lista muda por decisao dele, nao por deducao.

create or replace function public.nota_visual_da_peca(p_company_id uuid, p_drive_file_id text)
returns text
language plpgsql
stable
as $$
declare
  r record;
  v_universo text[] := array['consignado CLT','educacao financeira','seguranca'];
  v text;
begin
  if p_company_id is null or p_drive_file_id is null then
    return null;
  end if;

  select produto_detectado, aproveitavel, riscos_compliance, motivo, base_da_analise, nome
    into r
    from public.drive_midia_analises
   where drive_file_id = p_drive_file_id and company_id = p_company_id
   order by (base_da_analise like '%criterio%') desc, analisado_em desc
   limit 1;

  if not found then
    return ' Esta peca nao tem leitura visual registrada nesta empresa - nao ha nota a dar, e '
        || 'ausencia de leitura nao e ausencia de risco.';
  end if;

  v := ' LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para o gestor decidir; base '
    || coalesce(r.base_da_analise,'?') || '): produto detectado nos quadros: '
    || coalesce(r.produto_detectado,'nao classificado')
    || ', aproveitavel: ' || coalesce(r.aproveitavel,'nao classificado') || '.';

  if coalesce(r.riscos_compliance,'') not in ('','nenhum','NENHUM') then
    v := v || ' Risco anotado na leitura: "' || left(r.riscos_compliance, 400) || '".';
  else
    v := v || ' Nenhum risco especifico anotado na leitura.';
  end if;

  -- O MOTIVO entra SEMPRE. Foi a ausencia dele que tornava a nota inutil.
  if coalesce(r.motivo,'') <> '' then
    v := v || ' Por que a leitura classificou assim: "' || left(r.motivo, 400) || '".';
  end if;

  -- Divergencia declarada, na forma que o gestor pediu em 31/07.
  if r.produto_detectado is not null and not (r.produto_detectado = any(v_universo)) then
    v := v || ' ATENCAO, DIVERGENCIA A DECLARAR AO GESTOR: esta peca esta liberada por decisao '
          || 'dele de 31/07/2026, que liberou o acervo inteiro inclusive o que a leitura marcou '
          || 'como nao ou incerto - mas o visual aparenta "' || r.produto_detectado
          || '", que esta FORA do universo da marca (credito CLT, educacao financeira, seguranca). '
          || 'Diga isso ao gestor com estas palavras e deixe a escolha com ele. NAO recuse a peca '
          || 'por este motivo: recusar contrariaria a decisao dele.';
  end if;

  return v;
end;
$$;

comment on function public.nota_visual_da_peca(uuid, text) is
  'ESP-08: nota visual COMPLETA de uma peca do Drive, lendo a base com criterio vigente e incluindo o MOTIVO (que a versao anterior omitia). Declara divergencia de produto na forma pedida pelo gestor em 31/07 e NAO recusa - recusar contrariaria decisao humana vigente.';