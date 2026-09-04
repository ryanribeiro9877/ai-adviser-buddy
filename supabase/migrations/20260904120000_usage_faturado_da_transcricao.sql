-- O USAGE FATURADO DA TRANSCRICAO PASSA A SER GUARDADO
--
-- POR QUE. A apuracao de custo de 03/09/2026 (145 videos, US$ 0,15) foi DERIVADA, nao medida:
-- calibrei caracteres-por-segundo contra as duracoes conhecidas pelo mp4box e multipliquei pelo
-- preco publicado. Funcionou, mas e frágil por tres motivos - depende do preco externo estar
-- certo, depende da minha calibracao, e nao sobrevive a uma troca de modelo.
--
-- O dado exato sempre esteve na resposta e era jogado no lixo. A OpenAI devolve, em
-- `/v1/audio/transcriptions` com `response_format: json` (que e justamente o que a edge ja
-- usa, e o unico formato aceito por gpt-4o-mini-transcribe), um objeto `usage` com
-- `input_tokens`, `output_tokens`, `total_tokens` e `input_token_details.audio_tokens`. A edge
-- `transcribe-audio` devolvia `tokens_in: null, tokens_out: null` cravado no caminho da OpenAI
-- - o campo existia na assinatura e nunca era preenchido.
--
-- Guardo em jsonb, e nao em duas colunas de inteiro, por dois motivos concretos:
--   (1) o `usage` da OpenAI tem DUAS variantes de contrato: `{type:"tokens", input_tokens...}`
--       para modelos cobrados por token e `{type:"duration", seconds}` para modelos cobrados
--       por duracao de audio. Duas colunas fixas obrigariam a escolher uma variante hoje e
--       reescrever a coluna quando o modelo mudasse;
--   (2) `input_token_details.audio_tokens` e o numero que de fato importa para conferir a
--       fatura, e ele e aninhado. Achatar perderia a distincao entre token de audio e token de
--       texto do glossario - que sao cobrados igual mas tem causa diferente (um e o arquivo, o
--       outro e o prompt que NOS escrevemos e podemos encurtar).
--
-- Nao ha backfill possivel: o `usage` das 145 transcricoes ja feitas foi descartado na resposta
-- e nao e recuperavel sem transcrever de novo. Nao vale US$ 0,15 para reaver um numero que ja
-- foi estimado com margem conhecida. A coluna comeca nula e passa a valer da proxima em diante,
-- e a proxima apuracao podera dizer "medi" em vez de "derivei".

alter table public.drive_midia_analises
  add column if not exists transcricao_usage jsonb;

comment on column public.drive_midia_analises.transcricao_usage is
  'Objeto `usage` cru devolvido pelo transcritor, guardado para que a apuracao de custo seja '
  'MEDICAO e nao derivacao. Duas variantes possiveis: {type:"tokens", input_tokens, '
  'output_tokens, total_tokens, input_token_details:{audio_tokens,text_tokens}} para modelo '
  'cobrado por token, ou {type:"duration", seconds} para modelo cobrado por duracao. Nulo nas '
  '145 transcricoes anteriores a 04/09/2026, quando o campo era descartado na resposta - '
  'ausencia aqui significa "nao foi capturado", nao "custou zero".';
