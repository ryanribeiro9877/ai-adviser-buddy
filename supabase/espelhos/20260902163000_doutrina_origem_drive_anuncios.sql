-- ESPELHO DE MIGRACAO
-- version: 20260902163000
-- name: doutrina_origem_drive_anuncios
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)

-- Doutrina: origem Drive dos anuncios ja no ar (02/09/2026).
--
-- O pedido "de qual pasta do Drive sao os anuncios do CONJ.1 VISTTA" saiu com
-- 5 de 6 "sem vinculo". Os 6 cards de criacao tinham pasta e drive_file_id;
-- ads nao guarda o id. Inventario de pecas novas (get_drive_criativos) nao e
-- essa leitura. AD_…_2 nao implica 2.mp4 (o arquivo real era 10.mp4).

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
values (
  'doutrina',
  'ORIGEM DRIVE DOS ANUNCIOS JA NO AR (02/09/2026, traffic-chat v28.95 / job v4.18). '
  || 'Pergunta "de qual PASTA DO DRIVE sao os anuncios deste conjunto?" NAO e inventario '
  || 'de pecas novas. ads NAO guarda drive_file_id: o vinculo esta no card '
  || 'criar_anuncio_a_partir_de (payload.drive_file_id + execution_result.id_criado) e na '
  || 'pasta em drive_midia_analises. Chame origem_drive_dos_anuncios (conjunto + name_like '
  || 'da campanha) NESTE turno — uma chamada cobre todos os anuncios. '
  || 'PROIBIDO mapear AD_CONJ.N_…_2 para 2.mp4: no CONJ.1 VISTTA o _2 era 10.mp4, o _3 era '
  || '11.mp4, o _4 era 12.mp4, o _5 era 13.mp4, o _6 era 15.mp4, todos na pasta '
  || 'COHAPM Sistema Ocular · VISTTA/2026/08. Agosto/Reels/Apenas oculos. '
  || 'PROIBIDO declarar "sem vinculo" / "nao rastreavel" / "nao ha evidencia suficiente" '
  || 'se a tool trouxe pasta e drive_file_id. get_drive_criativos vazio NAO prova que a '
  || 'pasta nao existe (a arvore VISTTA tem ano/mes antes de Reels). '
  || 'casar_criativo_performance e plano B por anuncio: se drive_file_id+ad_external_id '
  || 'zerarem, a tool reconsulta so pelo anuncio — leia o aviso, nao encerre.',
  true,
  '2026-09-02',
  now()
);
