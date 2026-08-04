-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804193832
-- name: drive_liberacao_e_do_arquivo_nao_da_analise
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - A LIBERACAO DO GESTOR E ATRIBUTO DA PECA, NAO DA LINHA DE ANALISE.
--
-- PERGUNTA DO CLAUDE CODE, e ele estava certo em nao decidir sozinho: as 5 linhas da base
-- thumbnail/criterio-v2.4 nasceram com aprovado_pelo_gestor vazio, porque a coluna vive na linha
-- de ANALISE. Consequencia: quem consultar so a base nova ve veredito de maquina sem camada
-- humana. Ou a liberacao e do arquivo, ou e da leitura.
--
-- DECISAO: e DO ARQUIVO. O Roberto liberou PECAS em 31/07 - a frase dele foi sobre o acervo, e o
-- motivo foi que tudo passou por avaliacao humana (copy + gestor). Ele nao liberou uma analise;
-- liberou o material. Por isso a coluna na linha de analise era erro de modelagem: fazia a camada
-- humana se perder a cada base nova, e faria de novo na proxima mudanca de critério.
--
-- COMO, SEM QUEBRAR LEITOR: a decisao humana passa a viver UMA vez, em tabela propria; e um
-- gatilho propaga para toda linha de analise da mesma peca, inclusive as futuras. Assim
-- get_drive_analises e o pipeline continuam lendo a coluna que ja leem, e a verdade tem um dono.
-- Duas camadas preservadas: veredito de maquina por base, decisao humana por arquivo.

CREATE TABLE IF NOT EXISTS public.drive_pecas_liberadas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  nome          text,
  liberado      boolean NOT NULL,
  fonte         text NOT NULL,
  decidido_por  text NOT NULL,
  decidido_em   date NOT NULL,
  observacao    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_peca_liberada UNIQUE (company_id, drive_file_id)
);

COMMENT ON TABLE public.drive_pecas_liberadas IS
  'Decisao HUMANA sobre usar ou nao uma peca do Drive. UMA linha por arquivo, independente de quantas analises existam. A liberacao e da PECA, nao da leitura: o gestor libera material, nao veredito de maquina. Propagada para drive_midia_analises por gatilho, para leitor nenhum precisar mudar.';

ALTER TABLE public.drive_pecas_liberadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY pecas_liberadas_leitura ON public.drive_pecas_liberadas
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

-- Semeia com a decisao de 31/07, uma linha por arquivo (nao por analise).
INSERT INTO public.drive_pecas_liberadas
  (company_id, drive_file_id, nome, liberado, fonte, decidido_por, decidido_em, observacao)
SELECT DISTINCT ON (company_id, drive_file_id)
       company_id, drive_file_id, nome, true,
       coalesce(aprovacao_fonte, 'decisao do gestor 31/07/2026'),
       'Roberto', '2026-07-31',
       'Acervo inteiro liberado por audio em 31/07/2026 ("os vermelhos passam a se encaixar"), porque tudo passou por avaliacao humana de copy e do gestor. Liberacao da PECA - independe do veredito de maquina e sobrevive a qualquer reanalise.'
  FROM public.drive_midia_analises
 WHERE aprovado_pelo_gestor IS TRUE
ON CONFLICT (company_id, drive_file_id) DO NOTHING;

-- Gatilho: toda linha de analise herda a decisao humana da peca, inclusive as futuras.
CREATE OR REPLACE FUNCTION public.trg_drive_herda_liberacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
  SELECT liberado, fonte INTO v FROM drive_pecas_liberadas
   WHERE company_id = NEW.company_id AND drive_file_id = NEW.drive_file_id;
  IF FOUND THEN
    NEW.aprovado_pelo_gestor := v.liberado;
    NEW.aprovacao_fonte := v.fonte;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_drive_herda_liberacao ON public.drive_midia_analises;
CREATE TRIGGER trg_drive_herda_liberacao
  BEFORE INSERT ON public.drive_midia_analises
  FOR EACH ROW EXECUTE FUNCTION public.trg_drive_herda_liberacao();

-- Conserta as 5 linhas da base nova, que nasceram antes do gatilho existir.
UPDATE public.drive_midia_analises a
   SET aprovado_pelo_gestor = l.liberado, aprovacao_fonte = l.fonte
  FROM public.drive_pecas_liberadas l
 WHERE l.company_id = a.company_id AND l.drive_file_id = a.drive_file_id
   AND a.aprovado_pelo_gestor IS NULL;

COMMENT ON COLUMN public.drive_midia_analises.aprovado_pelo_gestor IS
  'DERIVADO de drive_pecas_liberadas por gatilho - NAO edite aqui. A liberacao e da PECA, nao da analise: alterar direto nesta coluna cria divergencia com a fonte. Para mudar a decisao humana, altere drive_pecas_liberadas.';

INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'LIBERACAO DE PECA E DECISAO DO ARQUIVO, VEREDITO E DA LEITURA (modelagem definida em 04/08/2026). '
  || 'O gestor libera MATERIAL, nao analise. Por isso drive_pecas_liberadas tem UMA linha por arquivo e '
  || 'sobrevive a qualquer reanalise, enquanto drive_midia_analises tem uma linha por (arquivo x base de '
  || 'analise) e cada uma carrega o veredito de maquina daquela leitura. Um gatilho propaga a decisao humana '
  || 'para toda linha de analise, inclusive as futuras - a coluna aprovado_pelo_gestor e DERIVADA. '
  || 'AO RESPONDER SOBRE UMA PECA: diga as duas coisas separadas. "Liberada pelo gestor em 31/07" e decisao '
  || 'humana e nao muda quando a maquina muda de opiniao; "produto detectado X na base Y" e leitura de '
  || 'maquina e pode mudar com criterio ou evidencia melhor. Nunca apresente uma como se fosse a outra.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');