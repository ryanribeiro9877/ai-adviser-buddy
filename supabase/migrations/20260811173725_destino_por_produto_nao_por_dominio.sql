-- 20260811173725 destino_por_produto_nao_por_dominio
--
-- CORRIGE a regra anterior (20260811171335), que decidia o destino do anuncio pelo DOMINIO
-- (legaleviver.com.br -> /simulacao-clt). Isso era largo demais: reescreveria um anuncio de
-- OUTRO produto do mesmo dominio para a LP de CLT. O criterio certo e o PRODUTO/OFERTA.
--
-- SINAIS MEDIDOS (universo legaleviver, 61 anuncios, 11/08/2026):
--   legenda/corpo: 50/61 CLT explicito, 0 outro produto, 11 vazias  -> sinal mais forte da OFERTA
--   nome do conjunto: 11/61 com token CLT; demais nomeiam publico, nao produto
--   nome do anuncio: 1/61 ; nome da campanha: 0/61 (as de teste novas trazem [CLT])
--   drive_midia_analises.produto_detectado: descreve o VISUAL da peca (liberado p/ CLT por
--     decisao do gestor) e NAO a oferta -> NAO entra na classificacao da oferta.
--   Nao existe NENHUM anuncio de produto != CLT no dominio hoje (0 FGTS/INSS/etc.).
--
-- Regra: produto CLT + destino divergente -> corrige para /simulacao-clt; produto OUTRO sem LP
-- decidida -> declara a lacuna, NAO reescreve; produto indeterminado -> preserva a URL do molde
-- e avisa. Nunca inventa URL, nunca reescreve por dominio.

-- 1) Tabela de destino por produto (procedencia + vigencia).
create table if not exists public.destino_por_produto (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  produto text not null,
  url_canonica text not null,
  vigente boolean not null default true,
  decidido_por text not null,
  decidido_em date not null,
  citacao_da_decisao text not null,
  memoria jsonb,
  created_at timestamptz not null default now(),
  constraint destino_uma_vigente unique (company_id, produto, vigente)
);
alter table public.destino_por_produto enable row level security;
drop policy if exists destino_por_produto_leitura on public.destino_por_produto;
create policy destino_por_produto_leitura on public.destino_por_produto
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

-- Seed: SO o que o gestor decidiu. Hoje so ha LP para credito consignado CLT.
insert into public.destino_por_produto (company_id, produto, url_canonica, decidido_por, decidido_em, citacao_da_decisao, memoria)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf','consignado_clt','https://legaleviver.com.br/simulacao-clt','Roberto (gestor)','2026-08-03','todas as campanhas a serem criadas e exclusivamente pra derramar no nosso site, na nossa LP', jsonb_build_object('origem','agent_context id 51 (audios 03/08 14:45 e 14:47); coleta GT-12 confirma /simulacao-clt nos moldes bons')
where not exists (select 1 from public.destino_por_produto where company_id='ded20b38-f42e-4c71-800c-31b97ea48bcf' and produto='consignado_clt' and vigente);

-- 2) Inferencia de produto pela OFERTA (texto e nomes; nao o visual do drive).
create or replace function public.inferir_produto_anuncio(p_company_id uuid, p_pedido jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_legenda text := nullif(btrim(coalesce(p_pedido->>'legenda','')),'');
  v_nome text := nullif(btrim(coalesce(p_pedido->>'nome_novo','')),'');
  v_molde text := coalesce(nullif(btrim(coalesce(p_pedido->>'creative_id','')),''),
                           nullif(btrim(coalesce(p_pedido->>'molde','')),''),
                           nullif(btrim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_conj text := coalesce(nullif(btrim(coalesce(p_pedido->>'conjunto_destino_external_id','')),''),
                          nullif(btrim(coalesce(p_pedido->>'conjunto_destino','')),''));
  v_body text; v_adset text; v_camp text;
  v_re_clt constant text := '(^|[^a-z])clt([^a-z]|$)|carteira assinada|consignad';
  v_re_outro constant text := 'fgts|inss|aposentad|benefici|negativ|nome sujo|serasa|portabilid|financiament|cons(o|ó)rci|im(o|ó)vel|abertura de conta';
  v_sinal text := null; v_produto text := null; v_evid text := null;
begin
  if v_molde is not null then
    select coalesce(a.body,'') into v_body from public.ads a
     where a.company_id=p_company_id and a.creative_id=v_molde limit 1;
  end if;
  if v_conj is not null then
    select coalesce(s.name,'') into v_adset from public.ad_sets s
     where s.company_id=p_company_id and s.external_id=v_conj limit 1;
    select coalesce(c.name,'') into v_camp from public.ad_sets s
      join public.campaigns c on c.id=s.campaign_id
     where s.company_id=p_company_id and s.external_id=v_conj limit 1;
  end if;

  for v_sinal, v_evid in
    select * from (values
      ('legenda', v_legenda),
      ('nome_do_conjunto', v_adset),
      ('corpo_do_molde', v_body),
      ('nome_do_anuncio', v_nome),
      ('nome_da_campanha', v_camp)
    ) t(sinal, txt) where nullif(btrim(coalesce(txt,'')),'') is not null
  loop
    if lower(v_evid) ~ v_re_clt then
      v_produto := 'consignado_clt';
      exit;
    elsif lower(v_evid) ~ v_re_outro then
      v_produto := 'outro';
      exit;
    end if;
  end loop;

  if v_produto is null then
    return jsonb_build_object('produto','indeterminado','sinal',null,'confianca','nenhuma',
      'evidencia',null,
      'observado', jsonb_build_object('legenda',v_legenda,'nome_conjunto',v_adset,'corpo_molde',left(v_body,120),'nome_anuncio',v_nome));
  end if;

  return jsonb_build_object('produto',v_produto,'sinal',v_sinal,
    'confianca', case when v_sinal in ('legenda','corpo_do_molde') then 'alta' else 'media' end,
    'evidencia', left(v_evid,160));
end;
$function$;
grant execute on function public.inferir_produto_anuncio(uuid,jsonb) to authenticated, service_role;

-- 3) Resolucao do destino a partir do produto + tabela.
create or replace function public.resolver_destino_do_anuncio(p_company_id uuid, p_pedido jsonb, p_url_molde text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_prod jsonb := public.inferir_produto_anuncio(p_company_id, p_pedido);
  v_produto text := v_prod->>'produto';
  v_molde text := coalesce(nullif(btrim(coalesce(p_pedido->>'creative_id','')),''),
                           nullif(btrim(coalesce(p_pedido->>'molde','')),''),
                           nullif(btrim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_url_molde text := nullif(btrim(coalesce(p_url_molde,'')),'');
  v_url_canon text; v_caso text; v_url_final text; v_corrigir boolean := false; v_msg text;
begin
  if v_url_molde is null and v_molde is not null then
    select a.destino_url into v_url_molde from public.ads a
     where a.company_id=p_company_id and a.creative_id=v_molde
       and a.destino_url_coletado_em is not null
     order by case when a.destino_url_situacao='unica' and a.destino_url is not null then 0 else 1 end,
              a.destino_url_coletado_em desc nulls last
     limit 1;
  end if;

  if v_produto = 'consignado_clt' then
    select url_canonica into v_url_canon from public.destino_por_produto
     where company_id=p_company_id and produto='consignado_clt' and vigente limit 1;
    v_caso := 'clt';
    v_url_final := coalesce(v_url_canon, v_url_molde);
    v_corrigir := v_url_canon is not null and (v_url_molde is distinct from v_url_canon);
    v_msg := 'Produto identificado como credito consignado CLT pelo sinal '||coalesce(v_prod->>'sinal','?')
          || '. Destino canonico: '||coalesce(v_url_canon,'(sem decisao)')||'.'
          || case when v_corrigir then ' O molde aponta para '||coalesce(v_url_molde,'(desconhecido)')||' e sera corrigido para o canonico na publicacao.'
                  when v_url_canon is not null then ' O molde ja aponta para o canonico.'
                  else '' end;
  elsif v_produto = 'outro' then
    select url_canonica into v_url_canon from public.destino_por_produto
     where company_id=p_company_id and produto=v_produto and vigente limit 1;
    if v_url_canon is null then
      v_caso := 'outro_sem_lp_decidida';
      v_url_final := v_url_molde;
      v_corrigir := false;
      v_msg := 'O anuncio parece ser de OUTRO produto (sinal '||coalesce(v_prod->>'sinal','?')||': "'||coalesce(v_prod->>'evidencia','')||'"), e NAO ha LP decidida para ele. Nao vou reescrever a URL para a de CLT nem inventar destino. Preserve a URL do molde ('||coalesce(v_url_molde,'desconhecida')||') ou peca ao gestor a LP correta desse produto.';
    else
      v_caso := 'outro';
      v_url_final := coalesce(v_url_canon, v_url_molde);
      v_corrigir := v_url_canon is not null and (v_url_molde is distinct from v_url_canon);
      v_msg := 'Produto OUTRO com LP decidida: '||v_url_canon||'.';
    end if;
  else
    v_caso := 'indeterminado';
    v_url_final := v_url_molde;
    v_corrigir := false;
    v_msg := 'Nao consegui determinar o produto do anuncio com confianca (sem CLT nem outro produto no texto/nome). NAO reescrevo a URL. Preservo a URL do molde ('||coalesce(v_url_molde,'desconhecida')||'). Para eu definir o destino, diga o produto (ex.: consignado CLT) ou use legenda/nome que o identifique.';
  end if;

  return v_prod || jsonb_build_object(
    'aplicavel', true,
    'caso', v_caso,
    'url_do_molde', v_url_molde,
    'url_canonica', v_url_canon,
    'url_final', v_url_final,
    'corrigir', v_corrigir,
    'mensagem', v_msg);
end;
$function$;
grant execute on function public.resolver_destino_do_anuncio(uuid,jsonb,text) to authenticated, service_role;

-- 4) Gate: anexa a decisao de destino por produto.
create or replace function public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_estado jsonb;
  v_dest jsonb;
  v_msg text;
begin
  v_base := public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id, p_pedido);
  if coalesce((v_base->>'completo')::boolean, false) is not true then
    return v_base;
  end if;

  v_estado := public.avaliar_estado_destino_execucao('criar_anuncio_a_partir_de', p_pedido, p_company_id);
  if coalesce((v_estado->>'valido')::boolean, true) is not true then
    return v_base || jsonb_build_object(
      'completo', false,
      'recusa', v_estado->>'recusa',
      'estado_destino', v_estado,
      'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor', v_estado->>'mensagem');
  end if;

  v_dest := public.resolver_destino_do_anuncio(p_company_id, p_pedido);
  v_msg := trim(coalesce(v_base->>'mensagem_para_o_gestor','') || ' DESTINO: ' || coalesce(v_dest->>'mensagem',''));

  return v_base || jsonb_build_object(
    'estado_destino', v_estado,
    'destino_do_anuncio', v_dest,
    'mensagem_para_o_gestor', v_msg);
end;
$function$;

comment on function public.pedido_de_anuncio_completo(uuid, jsonb) is
  'Gate antes do card. Mantem gates operacionais e de estado; anexa destino_do_anuncio (produto inferido + URL por produto). O destino e funcao do PRODUTO anunciado, nao do dominio: CLT divergente corrige para /simulacao-clt; produto sem LP decidida declara lacuna; produto indeterminado preserva a URL do molde e avisa. Nunca reescreve por dominio.';

revoke all on function public.pedido_de_anuncio_completo(uuid, jsonb) from public, anon;
grant execute on function public.pedido_de_anuncio_completo(uuid, jsonb) to authenticated, service_role;

-- 5) Remove o criterio antigo por dominio.
drop function if exists public.destino_url_lp_do_molde(uuid, text);
drop function if exists public.resolver_destino_url_lp_legal_e_viver(uuid, text);

-- 6) Contrato: destino por produto.
update public.contrato_de_execucao
   set observacao = 'URL de destino do anuncio. E funcao do PRODUTO anunciado, NAO do dominio. Na Legal e Viver so ha LP decidida para credito consignado CLT -> https://legaleviver.com.br/simulacao-clt (tabela destino_por_produto). Anuncio CLT com destino divergente e corrigido; produto diferente sem LP decidida NAO e reescrito (declara lacuna); produto indeterminado preserva a URL do molde e avisa. Nunca inventa URL. O card diz produto detectado, sinal usado e URL escolhida.',
       fonte = 'meta-actions montarCriacao v5.10 + resolver_destino_do_anuncio + inferir_produto_anuncio + destino_por_produto'
 where acao='criar_anuncio_a_partir_de' and campo='destino_url' and vigente;

-- 7) Doutrina do agente: substitui a regra por-dominio (id 106) pela regra por-produto.
update public.agent_context
   set vigente = false, atualizado = now()
 where company_id='ded20b38-f42e-4c71-800c-31b97ea48bcf' and vigente
   and (id = 106 or fato ilike '%DESTINO CANONICO LP/SITE%');

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'execucao',
  'DESTINO E FUNCAO DO PRODUTO, NAO DO DOMINIO (11/08/2026, corrige a regra anterior por-dominio). A URL de destino de um anuncio depende do PRODUTO/OFERTA anunciado, nao do dominio legaleviver.com.br. Hoje so existe LP decidida pelo Ryan/Roberto para CREDITO CONSIGNADO CLT -> https://legaleviver.com.br/simulacao-clt (tabela destino_por_produto; audios 03/08). TRES CASOS ao propor criar_anuncio_a_partir_de: (1) produto = consignado CLT e destino divergente -> CORRIGE para /simulacao-clt e diz no card qual sinal identificou (legenda > nome do conjunto > corpo do molde > nome do anuncio); (2) produto = OUTRO (FGTS/INSS/negativado/portabilidade/financiamento/consorcio/imovel etc.) -> NAO reescreve; se nao ha LP decidida para ele, declara a lacuna por nome e pede a LP ao gestor; NUNCA manda para a LP de CLT; (3) produto INDETERMINADO -> NAO reescreve em silencio: preserva a URL do molde e avisa o que faltou para identificar. O produto e inferido pela RPC inferir_produto_anuncio; a decisao completa vem em pedido_de_anuncio_completo.destino_do_anuncio. NOTA: drive_midia_analises.produto_detectado descreve o VISUAL da peca (liberado p/ CLT por decisao do gestor) e NAO define a oferta - nao use o visual para reclassificar a oferta.',
  true, current_date, 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 8) Prova embutida: os tres casos, read-only.
do $$
declare v jsonb; v_lev uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
begin
  v := public.resolver_destino_do_anuncio(v_lev, jsonb_build_object('legenda','Tem carteira assinada CLT? Consignado privado.','creative_id','1343315087658367'));
  if v->>'caso' <> 'clt' or (v->>'corrigir')::boolean is not true or v->>'url_final' <> 'https://legaleviver.com.br/simulacao-clt' then
    raise exception 'prova CLT corrige falhou: %', v; end if;

  v := public.resolver_destino_do_anuncio(v_lev, jsonb_build_object('legenda','Antecipacao do saque FGTS para voce'));
  if v->>'caso' <> 'outro_sem_lp_decidida' or (v->>'corrigir')::boolean is true then
    raise exception 'prova OUTRO falhou: %', v; end if;

  v := public.resolver_destino_do_anuncio(v_lev, jsonb_build_object('nome_novo','AD sem pistas'));
  if v->>'caso' <> 'indeterminado' or (v->>'corrigir')::boolean is true then
    raise exception 'prova INDETERMINADO falhou: %', v; end if;
end $$;
