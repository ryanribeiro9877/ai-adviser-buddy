-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805204546
-- name: esp09_promessas_proibidas_com_substituicao_segura
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-09 · as 10 promessas proibidas do contrato, COM o equivalente seguro.
--
-- POR QUE TABELA PROPRIA E NAO 10 REGRAS NOVAS: as 10 promessas sao INSTANCIAS de frase sob
-- regras que ja existem (FIN-01, FIN-02, FIN-04, FIN-07, LGL-01). Criar 10 regras duplicaria o
-- corpus e faria a mesma proibicao existir em dois lugares. Aqui elas viram pares
-- proibido -> seguro, apontando a regra que sustenta cada uma.
--
-- O CRITERIO DE ACEITE do card e "o gate devolve o equivalente seguro, nao so o veto". Por isso
-- a coluna 'seguro' e NOT NULL: onde o contrato diz "(nunca prometer)", o texto seguro e a
-- INSTRUCAO de retirar - nunca um campo vazio, porque vazio faria o gate sugerir nada e parecer
-- que nao tem sugestao.
--
-- DETECCAO: o padrao regex e AUXILIAR. O verificador deste projeto ja identifica por LLM e
-- decide por regra deterministica; esta tabela existe sobretudo para o MAPA DE SUBSTITUICAO.
-- Padrao largo demais gera falso positivo, e aqui falso positivo bloqueia peca correta.
--
-- DOIS BURACOS QUE EU DECLARO EM VEZ DE ESCONDER:
--   1. "maior limite" / comparativo sem prova NAO tem regra vigente que o cubra. As 17 regras
--      tratam de promessa, urgencia, identificacao e taxa - nenhuma trata de superioridade nao
--      comprovada. A linha entra com regra_code NULO e severidade propria.
--   2. "nao compromete a renda" foi mapeada para FIN-01 POR ANALOGIA (promessa incondicional
--      sobre o resultado). O encaixe e defensavel - em consignado a renda E comprometida, logo a
--      frase e falsa - mas uma regra especifica de margem faria isso melhor e nao existe.

create table if not exists public.promessas_proibidas (
  id uuid primary key default gen_random_uuid(),
  proibido text not null unique,
  padrao text not null,
  seguro text not null,
  severidade text not null,
  regra_code text,
  exige_presenca_de text,
  observacao text,
  fonte text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint promessas_severidade_valida check (severidade in ('bloqueia','atencao'))
);

comment on table public.promessas_proibidas is
  'ESP-09: pares promessa proibida -> equivalente seguro, do CONTRA_2 secao 4.3. O padrao regex e auxiliar; a deteccao principal segue no verificador. seguro e NOT NULL de proposito: onde o contrato diz "nunca prometer", o seguro e a instrucao de retirar.';
comment on column public.promessas_proibidas.exige_presenca_de is
  'Quando preenchido, a violacao so existe se o padrao casar E este token estiver AUSENTE do texto. Usado no caso da taxa citada sem CET.';
comment on column public.promessas_proibidas.regra_code is
  'Regra de compliance_rules que sustenta o veto. NULO significa que NENHUMA regra vigente cobre este caso - lacuna declarada, nao esquecimento.';

alter table public.promessas_proibidas enable row level security;
drop policy if exists promessas_leitura on public.promessas_proibidas;
create policy promessas_leitura on public.promessas_proibidas for select to authenticated using (true);

insert into public.promessas_proibidas
  (proibido, padrao, seguro, severidade, regra_code, exige_presenca_de, observacao, fonte)
values
('credito garantido / aprovacao garantida',
 '(aprovac|aprovaç|credito|crédito|liberac|liberaç)[^.!?]{0,25}garantid',
 'Consulte sua margem disponivel',
 'bloqueia','FIN-01',null,null,'CONTRA_2 §4.3 + FIN-01'),

('aprovacao na hora',
 '(aprovac|aprovaç|liberac|liberaç|sai|sao)[^.!?]{0,15}na hora',
 'Analise em ate X minutos',
 'bloqueia','FIN-01',null,'Trocar a promessa de resultado por prazo de PROCESSO, que e verificavel.','CONTRA_2 §4.3 + FIN-01'),

('sem consulta ao SPC/Serasa',
 'sem (consulta|analise|análise|spc|serasa)',
 'RETIRE a afirmacao. Nao existe equivalente seguro: a analise de credito existe e nao pode ser negada na peca.',
 'bloqueia','FIN-01',null,'O contrato marca este caso como "(nunca prometer)".','CONTRA_2 §4.3 + FIN-01'),

('para negativados',
 'para negativad|negativado pode|mesmo negativad',
 'Avaliamos seu perfil',
 'bloqueia','FIN-01',null,null,'CONTRA_2 §4.3 + FIN-01'),

('dinheiro facil / dinheiro rapido',
 'dinheiro (facil|fácil|rapido|rápido)|grana (facil|fácil|rapida|rápida)',
 'Credito consciente em poucos passos',
 'bloqueia','FIN-02',null,null,'CONTRA_2 §4.3 + FIN-02'),

('saia das dividas',
 'saia (das|da) (divida|dívida)|livre das (divida|dívida)|limpe (seu|o) nome',
 'Reorganize seu orcamento com responsabilidade',
 'bloqueia','FIN-07',null,null,'CONTRA_2 §4.3 + FIN-07'),

('maior limite / comparativo sem prova',
 'maior limite|(menor|melhor) taxa do mercado|o melhor do mercado|imbativel|imbatível',
 'RETIRE a comparacao, ou substitua por afirmacao verificavel sobre o proprio produto.',
 'atencao',null,null,
 'LACUNA DECLARADA: nenhuma das 17 regras vigentes cobre superioridade nao comprovada. Esta linha carrega o veredito sozinha ate existir regra propria.',
 'CONTRA_2 §4.3 (sem regra correspondente no corpus)'),

('taxa citada sem CET',
 '[0-9]+[,.][0-9]+ ?%|taxa de [0-9]|[0-9]+ ?x de R\$|parcela de R\$',
 'Cite o CET ao lado do numero, ou retire o numero da peca.',
 'bloqueia','FIN-04','CET',
 'Violacao CONDICIONAL: so existe se a peca citar numero de taxa/parcela E nao contiver "CET".',
 'CONTRA_2 §4.3/§4.4 + FIN-04 v2'),

('nao compromete a renda',
 '(nao|não) compromete a renda|sem comprometer (a renda|o salario|o salário)|(nao|não) pesa no bolso',
 'Mencione que a parcela e descontada e que ha analise de margem.',
 'bloqueia','FIN-01',null,
 'Mapeada para FIN-01 POR ANALOGIA (promessa incondicional sobre o resultado). Em consignado a renda E comprometida por construcao, logo a frase e falsa. Uma regra especifica de margem faria isso melhor e nao existe.',
 'CONTRA_2 §4.3 + FIN-01 por analogia'),

('ganho / presente / bonus para emprestimo',
 '(ganh[eo]|presente|b[oô]nus|premio|prêmio)[^.!?]{0,30}(emprestimo|empréstimo|credito|crédito)|(emprestimo|empréstimo|credito|crédito)[^.!?]{0,30}(e um|é um) (presente|ganho|b[oô]nus)',
 'Chame de credito ou emprestimo, e fale de responsabilidade.',
 'atencao','LGL-01',null,
 'Lei 14.181/2021: emprestimo nao pode ser apresentado como ganho, presente ou bonus.',
 'CONTRA_2 §4.3/§4.5 + LGL-01')
on conflict (proibido) do nothing;

-- O gate devolve o SEGURO, nao so o veto.
create or replace function public.checar_promessas_proibidas(p_texto text)
returns jsonb
language sql
stable
as $$
  select case when coalesce(btrim(p_texto),'') = '' then
    jsonb_build_object('avaliado', false, 'motivo', 'texto vazio - nao ha o que avaliar')
  else
    jsonb_build_object(
      'avaliado', true,
      'bloqueios', coalesce((select jsonb_agg(jsonb_build_object(
          'proibido', pp.proibido, 'seguro', pp.seguro,
          'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
          'observacao', pp.observacao))
        from public.promessas_proibidas pp
        where pp.active and pp.severidade = 'bloqueia'
          and p_texto ~* pp.padrao
          and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de)), '[]'::jsonb),
      'atencoes', coalesce((select jsonb_agg(jsonb_build_object(
          'proibido', pp.proibido, 'seguro', pp.seguro,
          'regra', coalesce(pp.regra_code,'(sem regra vigente que cubra)'),
          'observacao', pp.observacao))
        from public.promessas_proibidas pp
        where pp.active and pp.severidade = 'atencao'
          and p_texto ~* pp.padrao
          and (pp.exige_presenca_de is null or p_texto !~* pp.exige_presenca_de)), '[]'::jsonb),
      'nota', 'Este e o mapa de SUBSTITUICAO por frase. A deteccao principal continua no verificador de compliance; o padrao aqui e auxiliar e pode nao pegar variacao de escrita. Ausencia de casamento NAO e aprovacao.'
    )
  end;
$$;