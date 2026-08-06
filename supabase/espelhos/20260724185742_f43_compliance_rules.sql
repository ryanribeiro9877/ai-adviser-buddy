-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724185742
-- name: f43_compliance_rules
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F4.3: base de regras de compliance VERSIONADA para anúncios de crédito consignado.
-- Fonte única de verdade: motor validador (edge compliance-check) e chat leem daqui.
-- Atualizar regra = nova linha com version+1 e desativar a anterior (nunca editar in-place).
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null,                    -- ex: FIN-01
  categoria text not null check (categoria in ('legenda','criativo','ambos')),
  severidade text not null check (severidade in ('bloqueia','atencao')),
  regra text not null,                   -- enunciado aplicável
  fonte text,                            -- origem (política Meta, BACEN, CDC, prática)
  exemplos_violacao text,
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, version)
);
comment on table public.compliance_rules is 'F4.3: regras de compliance p/ anúncios (consignado). Versionada: mudanças criam version nova; active=false na antiga.';
alter table public.compliance_rules enable row level security;
create policy compliance_rules_read on public.compliance_rules for select to authenticated using (true);

insert into public.compliance_rules (code, categoria, severidade, regra, fonte, exemplos_violacao) values
('FIN-01','ambos','bloqueia','Não prometer aprovação garantida, crédito para negativado "sem análise" ou liberação incondicional. Toda concessão depende de análise.','Política Meta serviços financeiros + CDC art. 37 (publicidade enganosa)','"aprovação garantida", "sai na hora pra todo mundo", "sem consulta e sem análise"'),
('FIN-02','ambos','bloqueia','Não usar linguagem de enriquecimento fácil ou dinheiro rápido descontextualizado do produto de crédito.','Política Meta (práticas enganosas)','"dinheiro fácil", "ganhe R$ 5.000 agora", "renda extra garantida"'),
('FIN-03','legenda','bloqueia','Não alegar vínculo, parceria ou representação de INSS, Governo Federal ou órgão público sem que exista formalmente; não usar brasões/identidade visual de governo.','Lei 8.078 + práticas BACEN/INSS sobre consignado','"parceiro oficial do INSS", "programa do governo libera..."'),
('FIN-04','legenda','atencao','Ofertas com taxa de juros devem indicar que a taxa é "a partir de", sujeita a análise, e idealmente mencionar o CET (Custo Efetivo Total).','Res. CMN 4.881/Febraban (transparência) + boa prática','taxa fixa anunciada sem ressalva de análise/CET'),
('FIN-05','ambos','bloqueia','Não solicitar senha, dados bancários completos ou código de verificação no anúncio ou como condição de contato inicial.','Política Meta (segurança) + LGPD','"mande sua senha do app", "informe seu cartão para simular"'),
('FIN-06','ambos','atencao','Evitar urgência artificial enganosa (contagem regressiva falsa, "últimas vagas" para produto de crédito contínuo).','CDC art. 37 + política Meta','"só hoje!", "últimas 3 vagas para empréstimo"'),
('FIN-07','legenda','bloqueia','Não prometer cancelamento de dívida, "limpar nome" ou remoção de restrição como resultado garantido do produto.','CDC + jurisprudência sobre promessa de resultado','"limpe seu nome em 24h", "saia do Serasa garantido"'),
('FIN-08','ambos','atencao','Público majoritariamente aposentado/pensionista: linguagem deve ser clara e sem termos que explorem vulnerabilidade (medo de dívida, urgência de saúde).','Estatuto do Idoso art. 96 + boa prática consignado','apelo ao medo: "não deixe sua família desamparada, pegue o empréstimo"'),
('CRI-01','criativo','bloqueia','Imagem não pode exibir logotipo de banco/instituição sem autorização, nem selo/brasão de órgão público.','Marca registrada + política Meta','logo do INSS ou de banco parceiro sem contrato de uso de marca'),
('CRI-02','criativo','atencao','Evitar imagens de dinheiro em espécie em destaque excessivo (maços de notas, dinheiro voando) — sinaliza "get rich quick" para o review da Meta.','Política Meta serviços financeiros (sinais de reprovação)','pilha de dinheiro como elemento central do criativo'),
('CRI-03','criativo','bloqueia','Não simular interface de sistema (falso botão de "saque liberado", falsa notificação de banco/WhatsApp) que induza clique por engano.','Política Meta (engaging bait / práticas enganosas)','print falso de PIX recebido, botão falso "resgatar agora"'),
('CRI-04','criativo','atencao','Não usar imagem de pessoa que aparente ser figura pública/autoridade dando aval ao produto sem autorização.','Direito de imagem + política Meta','foto de apresentador de TV "recomendando" o consignado'),
('CRI-05','criativo','atencao','Texto sobre a imagem deve ser legível e coerente com a legenda; claims numéricos na arte seguem as mesmas regras da legenda (FIN-01..FIN-08).','Coerência de peça + política Meta','arte diz "taxa 0,99% garantida" enquanto legenda ressalva análise'),
('LGL-01','legenda','atencao','Identificar a natureza do produto: deixar claro que é empréstimo/crédito consignado (não "benefício", "liberação" ou "dinheiro do governo").','Transparência CDC','"você tem um valor a receber" sem dizer que é empréstimo'),
('LGL-02','legenda','bloqueia','Não afirmar ou sugerir que o contato já tem valor pré-aprovado nominal sem que exista oferta real vinculada àquela pessoa.','CDC art. 37 + política Meta (personalização enganosa)','"João, seu empréstimo de R$ 8.400 já está aprovado"'),
('LGL-03','ambos','atencao','Comunicar canal oficial de atendimento e não direcionar para números/links de terceiros não identificados.','Boa prática antifraude do setor','link encurtado sem identificação + "chame neste zap" de número avulso');