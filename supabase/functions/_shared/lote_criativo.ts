/** Espelho de src/lib/lote-criativo.ts — Deno nao importa o frontend. */
export function pedidoLoteCriativo(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  const pedeVarios =
    /\b(6 criativ|seis criativ|7 criativ|sete criativ|8 criativ|oito criativ|mais 6|separ[ae] mais|criativos diferentes|pecas diferentes|videos? diferentes|conjunto [2-4])\b/.test(
      p,
    ) || /\b(escolh|selecion|separ[ae])\w*.{0,80}\b(6|seis|7|sete|8|oito)\b/.test(p)
    || /\b(8 videos|oito videos|7 videos|sete videos)\b/.test(p);
  const pedeLegenda = /\b(legendas?|gerar copy|gere as legendas|gere legendas)\b/.test(p);
  const loteConjComOito =
    pedeLegenda && /\bconj(?:unto)?\.?\s*0*[1-4]\b/.test(p) && /\b(8|oito)\b/.test(p);
  return loteConjComOito || (pedeVarios && (
    pedeLegenda ||
    /\b(conjunto [2-4]|6 criativ|seis criativ|7 criativ|sete criativ|8 criativ|8 diferentes|seis diferentes|6 diferentes|7 diferentes)\b/.test(p)
  ));
}

export function replyLoteCriativoIncompleto(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  return (
    /\b(legendas? pendentes|nao cobertos por falta|consulta nao realizada nesta rodada|faltou tempo de coleta|as tres legendas do conjunto|ferramenta.{0,40}indisponivel|redator indisponivel|aguardar.{0,40}ferramenta|escrever.{0,40}(na mao|manualmente))\b/.test(
      t,
    ) || /\bnao vou invent/.test(t)
  );
}

export function replyLoteComLegendas(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  const nLegenda = t.match(/\blegenda\b/g)?.length ?? 0;
  return nLegenda >= 2 && /\b(veredito|drive file id|drive_file_id|conjunto [1-4])\b/.test(t);
}

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
