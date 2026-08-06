-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731184534
-- name: aprovacao_gestor_e_criterio_clt
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [DECISAO ROBERTO 31/07 - audios] Camada de APROVACAO HUMANA sobre a analise visual.
--
-- O QUE ELE DECIDIU (audio 15:39): todo o acervo do Drive pertence ao universo "credito
-- CLT / educacao financeira / dicas de seguranca financeira", ja passou por avaliacao
-- humana (copy + gestor de trafego) e DEVE ser usado - "os vermelhos passam a se encaixar
-- e os incertos tambem sao bons".
--
-- COMO IMPLEMENTAR SEM APAGAR A VERDADE: duas camadas.
--   camada 1 (imutavel): veredito VISUAL - o que os pixels mostram. Ha pecas que dizem
--   literalmente "financiamento de veiculo", "abertura de conta corrente", consorcio e
--   imovel; isso foi VISTO e continua registrado.
--   camada 2 (decisao): aprovado_pelo_gestor - libera o uso por decisao humana datada.
-- O agente opera pela camada 2 e DECLARA a divergencia quando a camada 1 discorda
-- (peca liberada cujo conteudo visual mostra outro produto) - nota, nunca veto.

alter table public.drive_midia_analises
  add column if not exists aprovado_pelo_gestor boolean not null default false,
  add column if not exists aprovacao_fonte text;

update public.drive_midia_analises
   set aprovado_pelo_gestor = true,
       aprovacao_fonte = 'Roberto, audio de 31/07/2026: acervo inteiro avaliado por copy + gestor de trafego; ordem de usar todos'
 where company_id = (select id from companies where name ilike '%legal%');

-- RPC v3: veredito operacional = decisao humana; veredito visual = informacao; divergencia declarada
create or replace function public.get_drive_analises(p_company_id uuid)
returns jsonb
language sql
stable
as $$
select case when p_company_id is null then
  jsonb_build_object('erro', 'p_company_id e obrigatorio')
else (
  with a as (
    select (coalesce(caminho,'') || '/' || nome) as arquivo,
           produto_detectado as produto,
           upper(left(aproveitavel,1)) as v,
           aprovado_pelo_gestor as g,
           case when aproveitavel in ('sim','incerto') then left(motivo, 70) end as motivo,
           nullif(left(coalesce(riscos_compliance,''), 60), '') as risco,
           (aprovado_pelo_gestor and aproveitavel = 'nao') as divergencia
    from public.drive_midia_analises
    where company_id = p_company_id
    order by case aproveitavel when 'sim' then 1 when 'incerto' then 2 else 3 end, caminho, nome
  )
  select jsonb_build_object(
    'total_analisados', (select count(*) from a),
    'resumo', jsonb_build_object(
       'aprovados_pelo_gestor', (select count(*) from a where g),
       'visual_sim', (select count(*) from a where v='S'),
       'visual_nao', (select count(*) from a where v='N'),
       'visual_incerto', (select count(*) from a where v='I'),
       'divergencias', (select count(*) from a where divergencia)),
    'nota', 'DUAS CAMADAS. (1) OPERACIONAL: g=true significa peca APROVADA para uso por decisao do gestor (audio 31/07: acervo inteiro passou por avaliacao humana de copy e gestor de trafego; ordem de usar todos) - ao operar, trate g=true como liberada e CITE a decisao e a data. (2) VISUAL (informacao, nunca veto): v S/N/I e o que os pixels da miniatura mostram; quando g=true e v=N a linha traz divergencia=true - a peca esta liberada MAS o conteudo visual aparenta outro produto: DECLARE isso como nota ao recomendar a peca, nunca esconda nem recuse. Universo criativo da marca por decisao do gestor: credito CLT + educacao financeira + dicas de seguranca. Pecas novas na pasta nascem g=false ate decisao humana. Texto visivel por peca existe no banco.',
    'itens', (select coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(x))), '[]'::jsonb) from a x)
  )
)
end;
$$;

select length((public.get_drive_analises((select id from companies where name ilike '%legal%')))::text) as tamanho,
       (public.get_drive_analises((select id from companies where name ilike '%legal%')))->'resumo' as resumo;