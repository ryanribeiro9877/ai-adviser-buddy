-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806111738
-- name: esp07_pecas_em_revisao_de_compliance
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-07 · o que faltava: o sistema nao sabia que estas pecas estao sob revisao.
--
-- O ESTADO MEDIDO EM 06/08: os 5 videos que citam valor/parcela/prazo estao com
-- aprovado_pelo_gestor = true E todos na biblioteca da Meta com meta_video_id. Ou seja: estao
-- a um card de serem publicados, e nada no sistema diz que ha uma pergunta aberta sobre eles.
-- A escalacao ao Roberto aconteceu por fora (WhatsApp), e decisao que vive so em conversa morre
-- na conversa.
--
-- POR QUE CAMADA NOVA E NAO drive_pecas_liberadas: aquela tabela guarda a decisao HUMANA de
-- 31/07 que liberou o acervo inteiro. Marcar liberado = false ali seria o sistema sobrescrevendo
-- o gestor. Duas camadas, nunca sobrescrita: a liberacao dele continua valendo, e ao lado dela
-- fica declarada uma revisao aberta que ele mesmo vai fechar.
--
-- E A REVISAO E LEGITIMA, nao e reabrir decisao dele: quando ele liberou em 31/07, a regra de
-- CET ainda era "idealmente" (FIN-04 v1). Ela virou BLOQUEANTE em 05/08 (FIN-04 v2). Mudou a
-- regua, nao a peca - e isso precisa estar escrito para ninguem ler como retrabalho.
--
-- bloqueia_uso NASCE false DE PROPOSITO: hoje a nota apenas DECLARA. Virar impedimento e
-- decisao do Ryan e custa um flag - nao quis decidir por ele algo que trava producao.

create table if not exists public.pecas_em_revisao (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  drive_file_id text not null,
  nome text,
  motivo text not null,
  regra_code text,
  evidencia text,
  bloqueia_uso boolean not null default false,
  aberto_em date not null default current_date,
  aberto_por text not null,
  veredito text,
  veredito_em date,
  veredito_por text,
  constraint pecas_revisao_unica unique (company_id, drive_file_id, aberto_em),
  constraint pecas_revisao_veredito_valido check (
    veredito is null or veredito in ('liberado_como_esta','ajustar_peca','nao_usar')),
  constraint pecas_revisao_veredito_datado check (
    (veredito is null and veredito_em is null and veredito_por is null)
    or (veredito is not null and veredito_em is not null and veredito_por is not null))
);

comment on table public.pecas_em_revisao is
  'ESP-07: pecas com pergunta de compliance ABERTA. Nao substitui drive_pecas_liberadas (decisao humana de 31/07) - fica ao lado dela. veredito NULO = aguardando. bloqueia_uso = false significa que a nota apenas declara; virar impedimento e decisao do Ryan.';
comment on column public.pecas_em_revisao.veredito is
  'liberado_como_esta | ajustar_peca | nao_usar. NULO = aguardando resposta. O CHECK exige data e autor junto com o veredito: decisao sem dono e sem data nao e decisao.';

alter table public.pecas_em_revisao enable row level security;
drop policy if exists pecas_revisao_leitura on public.pecas_em_revisao;
create policy pecas_revisao_leitura on public.pecas_em_revisao for select to authenticated
  using (public.is_company_member(company_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

-- Os cinco, com a evidencia DERIVADA do motivo da propria analise - nao transcrita por mim.
insert into public.pecas_em_revisao
  (company_id, drive_file_id, nome, motivo, regra_code, evidencia, aberto_por)
select d.company_id, d.drive_file_id, d.nome,
  'Cita valor, parcela e prazo na tela sem o CET ao lado. Escalado ao gestor Roberto em 06/08/2026 antes de qualquer publicacao. IMPORTANTE: a peca nao mudou - a REGUA mudou. Quando o acervo foi liberado em 31/07, o CET era recomendacao (FIN-04 v1); virou bloqueante em 05/08 (FIN-04 v2).',
  'FIN-04',
  substring(d.motivo from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*'),
  'Claude, a pedido do Ryan'
from public.drive_midia_analises d
where d.base_da_analise like '%criterio%'
  and d.motivo ilike '%MENCIONA VALOR/TAXA/PRAZO%'
on conflict (company_id, drive_file_id, aberto_em) do nothing;

-- A nota passa a declarar a revisao aberta, em primeiro lugar.
create or replace function public.nota_visual_da_peca(p_company_id uuid, p_drive_file_id text)
returns text
language plpgsql
stable
as $$
declare
  r record; rev record;
  v_universo text[] := array['consignado CLT','educacao financeira','seguranca'];
  v text := '';
begin
  if p_company_id is null or p_drive_file_id is null then
    return null;
  end if;

  -- revisao aberta vem PRIMEIRO: e a informacao que muda a decisao de usar ou nao.
  select * into rev from public.pecas_em_revisao
   where company_id = p_company_id and drive_file_id = p_drive_file_id and veredito is null
   order by aberto_em desc limit 1;

  if found then
    v := v || case when rev.bloqueia_uso
      then ' IMPEDIMENTO: esta peca esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito. '
      else ' ATENCAO - PECA EM REVISAO DE COMPLIANCE, sem veredito ate agora. Ela pode ser usada, mas o gestor precisa saber disto ANTES de aprovar. ' end
      || 'Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || rev.aberto_por
      || '. Motivo: ' || rev.motivo
      || case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end
      || case when rev.evidencia is not null then ' Evidencia: "' || left(rev.evidencia, 240) || '".' else '' end;
  end if;

  select produto_detectado, aproveitavel, riscos_compliance, motivo, base_da_analise, nome
    into r
    from public.drive_midia_analises
   where drive_file_id = p_drive_file_id and company_id = p_company_id
   order by (base_da_analise like '%criterio%') desc, analisado_em desc
   limit 1;

  if not found then
    return v || ' Esta peca nao tem leitura visual registrada nesta empresa - nao ha nota a dar, e '
             || 'ausencia de leitura nao e ausencia de risco.';
  end if;

  v := v || ' LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para o gestor decidir; base '
    || coalesce(r.base_da_analise,'?') || '): produto detectado nos quadros: '
    || coalesce(r.produto_detectado,'nao classificado')
    || ', aproveitavel: ' || coalesce(r.aproveitavel,'nao classificado') || '.';

  if coalesce(r.riscos_compliance,'') not in ('','nenhum','NENHUM') then
    v := v || ' Risco anotado na leitura: "' || left(r.riscos_compliance, 400) || '".';
  else
    v := v || ' Nenhum risco especifico anotado na leitura.';
  end if;

  if coalesce(r.motivo,'') <> '' then
    v := v || ' Por que a leitura classificou assim: "' || left(r.motivo, 400) || '".';
  end if;

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