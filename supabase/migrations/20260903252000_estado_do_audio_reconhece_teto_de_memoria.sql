-- O ESTADO CANONICO DO AUDIO APRENDE O QUARTO ROTULO: TETO DE MEMORIA DO RUNTIME
--
-- POR QUE, e isto foi descoberto ESCOANDO e nao planejando. O escoamento do acervo
-- (03/09/2026) transcreveu 97 videos e entao travou: a fila parou em 33 pendentes e cada
-- corrida seguinte devolvia HTTP 546 - limite de recursos do worker da edge - sem
-- processar nada. Causa: `drive-audio-transcribe` baixa o video INTEIRO para memoria e o
-- mp4box faz copias internas ao segmentar. Os 33 que restaram sao em boa parte `.MOV`
-- brutos da pasta "Brutos" da COHAPM, grandes o bastante para estourar o worker. E como o
-- worker morria DEPOIS de baixar, um unico arquivo grande derrubava a corrida inteira e
-- bloqueava os videos pequenos atras dele na fila - entre eles os do Juridico, que sao
-- justamente os de interesse de compliance.
--
-- A edge passa a checar o tamanho ANTES de baixar e a marcar quem excede com o rotulo
-- `acima_do_limite_de_memoria:`. Aqui, esse rotulo entra como `falha_tecnica`, e nao como
-- `sem_fala`, porque a distincao e o ponto: video sem locucao foi ouvido e nao tem fala;
-- video grande demais NAO foi ouvido por limitacao nossa, e a lacuna continua aberta. Cai
-- em `falha_tecnica` de proposito por dois efeitos praticos: sai da fila (para nao derrubar
-- corrida futura) e `checar_par_texto_e_peca` declara "AUDIO INACESSIVEL" na peca, que e a
-- verdade a dizer a quem for aprovar um anuncio com ela.
--
-- O teto de 60MB e empirico: o maior arquivo que comprovadamente passou tem 55,2MB, medido
-- entre os 97 transcritos. Se o runtime crescer, mexa no teto da edge e reprocesse - nada
-- aqui precisa mudar.

create or replace function public.estado_do_audio_da_peca(
  p_transcricao text,
  p_fonte text,
  p_mime text
)
returns text
language sql
immutable
as $function$
  select case
    -- imagem/vetor nao tem faixa de audio: nao e lacuna, e inaplicavel.
    when coalesce(p_mime,'') not like 'video%'                    then 'nao_se_aplica'
    when coalesce(btrim(p_transcricao),'') <> ''                  then 'transcrito'
    -- conferido e sem locucao. `sem_fala_util` e o rotulo dos 5 Reels do Sistema Ocular e
    -- passou a ser tambem o que a edge grava quando o transcritor devolve texto vazio;
    -- `sem_fala_detectada` fica reconhecido pelo historico ja gravado.
    when coalesce(p_fonte,'') like 'sem_fala_util%'
      or coalesce(p_fonte,'') like 'sem_fala_detectada%'          then 'sem_fala'
    -- NAO foi ouvido, por defeito do arquivo ou por limite nosso. As duas coisas sao
    -- lacuna, e nenhuma das duas e ausencia de fala.
    when coalesce(p_fonte,'') like 'sem_audio_ou_corrompido%'
      or coalesce(p_fonte,'') like 'acima_do_limite_de_memoria%'  then 'falha_tecnica'
    else 'nao_avaliado'
  end;
$function$;

comment on function public.estado_do_audio_da_peca(text, text, text) is
  'Estado do audio de uma peca do Drive: nao_se_aplica (nao e video), transcrito, sem_fala '
  '(conferido, sem locucao), falha_tecnica (arquivo sem audio extraivel OU acima do teto de '
  'memoria da edge) ou nao_avaliado. Fonte unica: nao reimplemente a leitura de '
  'transcricao_fonte em consumidor novo.';
