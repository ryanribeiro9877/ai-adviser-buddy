-- REGISTRA O PRECO DO TRANSCRITOR DE AUDIO EM model_prices
--
-- POR QUE. A apuracao de custo do escoamento do acervo de audio (03/09/2026) teve de
-- recorrer a preco publicado fora do sistema, porque `model_prices` nao tinha linha para
-- `gpt-4o-mini-transcribe` - o modelo que `transcribe-audio` usa. Sem a linha, toda
-- apuracao futura repete a mesma consulta externa e fica sem rastro de onde tirou o numero.
--
-- HONESTIDADE SOBRE A ORIGEM DO NUMERO, que importa mais que o numero. Isto e preco
-- PUBLICADO pela OpenAI, nao fatura conferida. O escoamento mediu a DURACAO real do audio
-- (49,4 min pelo mp4box e por calibragem de caracteres/segundo sobre 25 pecas cronometradas)
-- mas nao teve acesso ao valor faturado, entao o custo em dolar continua sendo derivacao, e
-- nao medicao. O campo `fonte` diz isso de forma que a proxima apuracao nao confunda as duas
-- coisas. Quando houver fatura, confira e corrija - a tabela e versionada por `vigente_de`.
--
-- SOBRE A UNIDADE. Esta tabela cobra por milhao de tokens e o transcritor cobra por token de
-- audio na entrada. A equivalencia por minuto que a OpenAI publica (US$ 0,003/min) esta na
-- `fonte` porque e ela que serve para orcar escoamento de acervo, onde o que se conhece de
-- antemao e a duracao, nao a contagem de tokens.
--
-- CUIDADO COM A TABELA ERRADA, porque quase caimos nela. A OpenAI publica DOIS precos para
-- este modelo: US$ 1,25/1M de token de audio na API de transcricao, e US$ 3,00/1M na tabela
-- da Realtime API. O que vale aqui e 1,25, porque `transcribe-audio` chama
-- /v1/audio/transcriptions e nao a Realtime. Conferido em 03/09/2026 contra tres fontes
-- independentes que convergem em 1,25 in / 5,00 out.

insert into public.model_prices
  (model, moeda, preco_in_por_milhao, preco_out_por_milhao, vigente_de, fonte)
select 'gpt-4o-mini-transcribe', 'USD', 1.25, 5.00, date '2026-09-03',
       'Preco publicado OpenAI para /v1/audio/transcriptions, conferido em 03/09/2026 contra '
       'tres fontes independentes durante o escoamento do acervo de audio do Drive. Entrada = '
       'token de AUDIO; saida = token de texto transcrito. Equivalencia publicada para orcar '
       'por duracao: US$ 0,003 por minuto. NAO confundir com a tabela da Realtime API, que '
       'lista US$ 3,00/1M para o mesmo modelo. NAO conferido contra fatura: o escoamento '
       'mediu duracao real, nao valor faturado. Ao obter fatura, abrir nova vigencia em vez '
       'de editar esta linha.'
where not exists (
  select 1 from public.model_prices
   where model = 'gpt-4o-mini-transcribe' and vigente_ate is null
);
