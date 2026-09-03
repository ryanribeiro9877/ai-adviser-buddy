-- Veredito sobre `transcrever-audios-drive`: NAO aposentar. Agendar.
--
-- A tarefa estava catalogada como inativa com a observacao "aguarda decisao do gestor". Antes
-- de transformar isso em pergunta, fui medir se ela ainda faz sentido. Os dois criterios que
-- justificariam aposentar sao "ninguem consome o resultado" e "nada chega". Os dois sao falsos:
--
-- CONSUMIDOR VIVO. `public.get_acervo_para_anuncio` -- a leitura do acervo que alimenta a
-- criacao de anuncio -- entrega dois campos que saem diretamente daqui: `o_que_diz_no_audio`
-- (o texto da transcricao) e `transcricao_ausente` / `videos_sem_transcricao` (a contagem do
-- que falta). Sem transcricao, quem escolhe criativo escolhe sem saber o que o video fala.
--
-- CHEGA MATERIAL. O ultimo arquivo lido no Drive e de 28/08 e a ultima analise de 31/08; nesse
-- mesmo dia entraram 5 videos novos com analise `multiquadro/criterio-ocular-v1`, que e o
-- recorte que a tarefa processa. Entao o fluxo esta ativo, nao parado.
--
-- E ELA FUNCIONA. Dos videos no recorte da tarefa: 19 transcritos com texto gravado e 5 com
-- falha honesta e permanente (`sem_fala_util`), zero pendentes. Ou seja, a tarefa convergiu o
-- backlog dela e hoje seria um no-op idempotente -- que e exatamente o comportamento correto
-- de uma tarefa de escoamento, e nao sinal de que esteja morta. A razao de "parecer" morta era
-- nao ter agendamento nenhum em `cron.job`, e nao falta de proposito.
--
-- O RISCO DE DEIXAR DESLIGADA e silencioso e assimetrico: enquanto nao chega video novo com
-- fala, nada acontece; no dia que chegar, ninguem transcreve e o agente de criacao escolhe
-- criativo no escuro, sem nenhum aviso de que esta fazendo isso.
--
-- Agendada as 09:50, depois das varreduras do Drive das 08:45/08:46, para que a transcricao
-- rode sobre o que a varredura acabou de trazer, e nao um dia atras dele.
--
-- FICA PARA O GESTOR, com o numero: a tarefa so transcreve video cuja analise e
-- `multiquadro/*`. Existem 172 videos analisados so por `thumbnail` que ela nunca vai pegar,
-- e que hoje chegam ao agente de criacao com `transcricao_ausente`. Ampliar o recorte para
-- eles e decisao de custo e de escopo do pipeline de analise -- tem preco de API por arquivo
-- e nao e algo que o dado decida sozinho. Nao mexi nisso.

update public.tarefas_agendadas
   set ativa = true,
       observacao = 'Reativada em 03/09/2026 com evidencia: consumidor vivo (get_acervo_para_anuncio serve o_que_diz_no_audio ao agente de criacao), material chegando (5 videos multiquadro em 31/08) e backlog convergido (19 transcritos, 5 falhas honestas, 0 pendentes). Recorte limitado a analise multiquadro/*; os 172 videos analisados so por thumbnail seguem fora por decisao de escopo e custo, pendente do gestor.'
 where tarefa = 'transcrever-audios-drive';

select cron.schedule('transcrever-audios-0950', '50 9 * * *',
  $cmd$ select public.disparar_tarefa_http('transcrever-audios-drive'); $cmd$);
