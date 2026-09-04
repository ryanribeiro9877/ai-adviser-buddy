-- A FILA DE TRANSCRICAO PASSA A SER POR ARQUIVO, E NAO POR LINHA DE ANALISE
--
-- POR QUE. `drive-audio-transcribe` selecionava com
--   .like("base_da_analise", "%criterio%").is("transcricao_audio", null)
-- ou seja: linhas, e so as de analise multiquadro. Duas consequencias, as duas medidas em
-- 03/09/2026:
--
-- (a) ESCOPO CURTO. Os videos analisados so por `thumbnail` nunca entravam. Eram 172
--     LINHAS - e o numero 172 circulou na apuracao como se fossem 172 arquivos.
--     Nao eram: `drive_midia_analises` tem 196 linhas de video para 172 arquivos
--     distintos, porque um mesmo arquivo pode ter linha de thumbnail E de multiquadro.
--     Feita a deduplicacao por `drive_file_id`, o que de fato nunca foi ouvido sao
--     148 arquivos: 143 da COHAPM e 5 da Legal e Viver. Os outros 24 daquelas 172 linhas
--     sao os arquivos que JA estao transcritos pela linha multiquadro deles.
--
-- (b) RISCO DE PAGAR DUAS VEZES. Se a correcao fosse so tirar o filtro de
--     `base_da_analise`, a fila passaria a incluir as 19 linhas de thumbnail dos arquivos
--     da Legal que ja estao transcritos pela outra linha - e a edge, olhando linha a
--     linha, veria `transcricao_audio is null` e mandaria tudo de novo para a OpenAI.
--     Seria pagar de novo por audio ja lido, e gravar a mesma fala em duas linhas.
--
-- Entao a fila deduplica por arquivo ANTES de decidir, com a mesma regra de preferencia
-- que `get_acervo_para_anuncio` usa (linha de criterio na frente, depois a mais recente),
-- e pergunta o estado a funcao canonica `estado_do_audio_da_peca`. So entra quem esta
-- `nao_avaliado`. Isso exclui de graca os 5 `sem_fala_util` (estado `sem_fala`) e os
-- arquivos com falha permanente de extracao (`falha_tecnica`), sem lista negra a manter.

create or replace function public.videos_com_audio_pendente(p_limit integer default 6)
returns table(
  id uuid,
  drive_file_id text,
  nome text,
  mime text,
  company_id uuid,
  caminho text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with melhor as (
    select distinct on (d.drive_file_id)
           d.id, d.drive_file_id, d.nome, d.mime, d.company_id, d.caminho,
           d.transcricao_audio, d.transcricao_fonte
      from public.drive_midia_analises d
     where d.mime like 'video%'
     order by d.drive_file_id,
              (d.base_da_analise like '%criterio%') desc,
              d.analisado_em desc nulls last
  )
  select m.id, m.drive_file_id, m.nome, m.mime, m.company_id, m.caminho
    from melhor m
   where public.estado_do_audio_da_peca(m.transcricao_audio, m.transcricao_fonte, m.mime)
         = 'nao_avaliado'
   order by m.company_id, m.nome
   limit greatest(1, least(50, coalesce(p_limit, 6)));
$function$;

comment on function public.videos_com_audio_pendente(integer) is
  'Fila de transcricao DEDUPLICADA POR ARQUIVO: um arquivo com linha de thumbnail e de '
  'multiquadro aparece uma vez so, e nao aparece se qualquer das linhas ja resolveu o '
  'audio. Evita pagar duas vezes pelo mesmo audio. Consumida por drive-audio-transcribe.';

create or replace function public.contar_videos_com_audio_pendente()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  with melhor as (
    select distinct on (d.drive_file_id)
           d.drive_file_id, d.mime, d.transcricao_audio, d.transcricao_fonte
      from public.drive_midia_analises d
     where d.mime like 'video%'
     order by d.drive_file_id,
              (d.base_da_analise like '%criterio%') desc,
              d.analisado_em desc nulls last
  )
  select count(*)::integer
    from melhor m
   where public.estado_do_audio_da_peca(m.transcricao_audio, m.transcricao_fonte, m.mime)
         = 'nao_avaliado';
$function$;

comment on function public.contar_videos_com_audio_pendente() is
  'Quantos ARQUIVOS de video seguem sem audio avaliado. Serve de sinal de convergencia '
  'para o cron: quando chega a zero, a rotina vira no-op ate chegar material novo.';
