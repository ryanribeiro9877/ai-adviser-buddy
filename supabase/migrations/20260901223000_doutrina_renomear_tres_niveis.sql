-- Doutrina alinhada com as ferramentas que passaram a existir em 01/09/2026.
--
-- Duas frases da memoria viraram mentira e uma terceira nunca foi dita:
-- (1) id 135 afirmava "renomear_campanha e pipeboard-only". A trava caiu; renomear e POST /{id}
--     com `name` e sai pelos dois drivers. Deixar a frase de pe faria o agente recusar sozinho
--     mesmo com o portao aberto — foi exatamente assim que a COHAPM levou driver_nao_suporta_acao.
-- (2) ids 190 e 191 listavam as flags ligadas e paravam em renomear_campanha.
-- (3) Nada dizia que renomear existe no conjunto e no anuncio. Sem isso o agente repete o que fez
--     hoje: acha o objeto, sabe o nome certo e manda o gestor renomear na mao no Gerenciador.

update public.agent_context
   set fato = 'DRIVER DE TRANSPORTE POR ACAO (ESP-29, 12/08/2026; matriz revista em 01/09/2026). '
              || 'O driver (graph|pipeboard) do ultimo passo e resolvido POR ACAO via '
              || 'resolver_driver(company_id, acao): precedencia override em '
              || 'meta_execution_config.driver_por_acao > driver_escrita (empresa) > graph. '
              || 'Matriz de capacidade ATUAL: vincular_instagram_dos_anuncios e graph-only '
              || '(republica o anuncio com criativo novo, que o Pipeboard nao expoe); TODAS as '
              || 'demais acoes sancionadas, renomear_campanha / renomear_conjunto / '
              || 'renomear_criativo inclusive, aceitam graph e pipeboard. A antiga regra '
              || '"renomear_campanha e pipeboard-only" MORREU em 01/09/2026: vinha de como a '
              || 'ferramenta foi introduzida em 10/08, nao de limite da Meta, e recusou rename '
              || 'legitimo da COHAPM com driver_nao_suporta_acao. pode_executar_acao e '
              || 'meta-actions usam o driver RESOLVIDO; o driver decide ONDE sai, nunca SE sai '
              || '(permissao continua em master_enabled + action_flags + limites).',
       atualizado = now()
 where id = 135;

update public.agent_context
   set fato = replace(
                fato,
                'renomear_campanha, escalar_duplicar',
                'renomear_campanha, renomear_conjunto, renomear_criativo, escalar_duplicar'
              ),
       atualizado = now()
 where id = 190;

update public.agent_context
   set fato = fato || ' Desde 01/09/2026 renomear vale nos tres niveis (campanha, conjunto e anuncio).',
       atualizado = now()
 where id = 191;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
values (
  'doutrina',
  'RENOMEAR EXISTE NOS TRES NIVEIS; EXCLUIR NAO EXISTE EM NENHUM (01/09/2026). '
  || 'Acoes sancionadas: renomear_campanha, renomear_conjunto e renomear_criativo. As tres pedem '
  || 'target_name (o nome ATUAL do objeto) e params.novo_nome, passam por card de aprovacao e '
  || 'alteram SOMENTE o campo name — id, status, orcamento, criativo e entrega ficam intactos. '
  || 'Nome livre continua valendo (ESP-40 / 21/08): novo_nome e string arbitraria, nao exija '
  || 'colchetes. Depois da escrita, meta-actions espelha o nome em campaigns/ad_sets/ads, entao a '
  || 'leitura seguinte ja traz o nome novo. '
  || 'PROIBIDO mandar o gestor renomear na mao no Gerenciador de Anuncios: em 01/09/2026 dois '
  || 'anuncios do CONJ.2_VISTTA nasceram com o nome do conjunto no lugar do nome do criativo, o '
  || 'agente identificou os dois, soube dizer o nome correto de cada um e mesmo assim encerrou com '
  || '"nao existe card de renomeacao de anuncio; faca no Gerenciador". Nao existia — passou a '
  || 'existir. Se a acao estiver desligada para a empresa, diga a trava pelo nome; nao invente '
  || 'limitacao da Meta. '
  || 'EXCLUIR objeto publicado NAO EXISTE em nenhum nivel, por decisao do sistema: o historico de '
  || 'entrega e gasto precisa ficar de pe. Pedido de "excluir/deletar anuncio, conjunto ou '
  || 'campanha" se resolve com pausar_criativo / pausar_conjunto / pausar_campanha, e o objeto '
  || 'pausado para de entregar. Diga isso claramente em vez de prometer exclusao. '
  || 'ANTES de propor rename, LEIA os nomes que ja existem no conjunto (get_estrutura_conjuntos): '
  || 'renomear para um nome ja ocupado cria duplicata e reabre a ambiguidade de alvo que ja custou '
  || 'cards recusados por conjunto_destino_ambiguo.',
  true,
  '2026-09-01',
  now()
);
