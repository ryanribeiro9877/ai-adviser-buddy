-- ALVO DO CARD POR external_id: doutrina do desempate quando o nome nao e unico.
--
-- Em 01/09/2026, meia hora depois de renomear_criativo entrar no ar, o mesmo pedido voltou a
-- terminar em "renomeie na mao no Gerenciador". A ferramenta existia; o ALVO e que era
-- inalcancavel. Os dois anuncios do CONJ.2_VISTTA tem a MESMA string de nome, e o resolvedor de
-- alvo do propose_action so aceitava nome: "peca o NOME COMPLETO EXATO" e um pedido sem resposta
-- possivel entre homonimos. O agente leu ambiguidade, concluiu limitacao e devolveu trabalho
-- manual — pela segunda vez no mesmo dia, pelo mesmo objeto.

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
values (
  'doutrina',
  'ALVO DE CARD POR external_id QUANDO O NOME NAO E UNICO (01/09/2026, traffic-chat v28.92). '
  || 'propose_action aceita params.alvo_external_id: o id da Meta do objeto alvo, em QUALQUER '
  || 'acao sobre objeto (renomear, pausar, ativar, orcamento, posicionamentos). Ele tem '
  || 'precedencia sobre target_name — com o id, o sistema nao procura por nome. '
  || 'QUANDO USAR: sempre que a emissao voltar com ambiguo=true. A resposta agora traz os '
  || 'external_id de cada candidato; escolha um e reemita. '
  || 'PROIBIDO, nesse caso, pedir ao gestor "o nome completo exato": se dois objetos tem a MESMA '
  || 'string, nenhum nome que ele digitar desempata, e insistir nisso e loop. Igualmente PROIBIDO '
  || 'concluir que a acao nao existe ou mandar resolver no Gerenciador de Anuncios — foi o que '
  || 'aconteceu com os dois anuncios homonimos CONJ.2_VISTTA_WA_7199185-8107 '
  || '(120249836422310182 e 120249836423210182). Se voce nao souber qual id e qual, MOSTRE a '
  || 'lista de candidatos com id, nome e video ao gestor e pergunte — isso e uma pergunta '
  || 'respondivel; "qual o nome exato?" nao e. '
  || 'Onde achar o id: get_estrutura_conjuntos (conjuntos), get_criativos_conteudo com '
  || 'busca_nome (anuncios, campo external_id) e get_aprovacoes (cards ja executados).',
  true,
  '2026-09-01',
  now()
);
