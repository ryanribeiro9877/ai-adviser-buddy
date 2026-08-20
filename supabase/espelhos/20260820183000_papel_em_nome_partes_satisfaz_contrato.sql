-- ESP-39/40: campo contrato `papel` (e demais partes do nome) pode viver em
-- nome_partes.<campo>. validar_pedido_contra_contrato usava so a raiz e recusava
-- pedidos que o emissor (gravarCard) ja montava corretamente — o agente perdia
-- tempo "corrigindo" papel na raiz e o propose caia no deadline (IMPULSAO 20/08).

CREATE OR REPLACE FUNCTION public.campo_presente_no_pedido(p_pedido jsonb, p_campo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- Raiz do pedido
    WHEN p_pedido IS NOT NULL AND (p_pedido ? p_campo) THEN
      CASE jsonb_typeof(p_pedido -> p_campo)
        WHEN 'null'   THEN false
        WHEN 'string' THEN nullif(btrim(p_pedido ->> p_campo), '') IS NOT NULL
        WHEN 'array'  THEN jsonb_array_length(p_pedido -> p_campo) > 0
        WHEN 'object' THEN (p_pedido -> p_campo) <> '{}'::jsonb
        ELSE true
      END
    -- ESP-40/39: partes do nome compostas em nome_partes
    WHEN p_campo IN ('papel', 'marca', 'canal', 'objetivo_tag', 'produto', 'rotulo', 'periodo')
         AND p_pedido IS NOT NULL
         AND jsonb_typeof(p_pedido -> 'nome_partes') = 'object'
         AND (p_pedido -> 'nome_partes' ? p_campo) THEN
      CASE jsonb_typeof(p_pedido -> 'nome_partes' -> p_campo)
        WHEN 'null'   THEN false
        WHEN 'string' THEN nullif(btrim(p_pedido -> 'nome_partes' ->> p_campo), '') IS NOT NULL
        ELSE true
      END
    ELSE false
  END;
$function$;

COMMENT ON FUNCTION public.campo_presente_no_pedido(jsonb, text) IS
  'Um pedido tem este campo? Vazio nao conta. Aceita tambem ESP-40 partes em nome_partes '
  '(papel/marca/canal/objetivo_tag/produto/rotulo/periodo). Fonte unica de validar_pedido '
  'e pedido_de_anuncio_completo.';

UPDATE public.contrato_de_execucao
   SET observacao = 'ESP-39: TESTE|ESCALA. Obrigatorio na campanha. Aceito na raiz OU em nome_partes.papel (o emissor grava nos dois).'
 WHERE acao IN ('criar_campanha', 'renomear_campanha')
   AND campo = 'papel'
   AND vigente;
