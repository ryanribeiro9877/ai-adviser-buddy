-- 23/09/2026. Pedido de legendas da pasta de setembro lia o acervo inteiro
-- (34 itens, 50 omitidos) e a janela acabava antes de gerar_legendas.
-- pasta recorta o caminho (ex.: setembro = "09. Setembro").

update public.agent_ferramentas
   set descricao = case
         when descricao like '%passe pasta%' then descricao
         else descricao || ' Se o gestor citou a pasta do mes (setembro, 09. Setembro), passe pasta com esse mes: o servidor recorta o caminho e nao devolve o acervo inteiro.'
       end,
       parametros = case
         when parametros #> '{properties,pasta}' is null then jsonb_set(
           parametros,
           '{properties,pasta}',
           '{"type":"string","description":"Mes ou trecho do caminho, ex.: setembro. Obrigatorio quando o gestor citou a pasta."}'::jsonb,
           true
         )
         else parametros
       end,
       atualizado_em = now()
 where chave in ('get_acervo_para_anuncio', 'get_drive_criativos', 'get_analise_visual_drive');
