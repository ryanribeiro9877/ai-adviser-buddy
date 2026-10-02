// O texto que o gestor le tem de ser o status que o payload vai gravar.
// ACTIVE gasta no instante da aprovacao. PAUSADO nao. Misturar os dois e o bug.

export function textoLembreteDeCriacao(statusInicial: string): string {
  const st = String(statusInicial ?? "ACTIVE").trim().toUpperCase() || "ACTIVE";
  if (st === "ACTIVE") {
    return "Objeto criado ACTIVE. A aprovacao autoriza entrega e o gasto pode comecar no instante em que o card for aprovado. Validado na Meta nao significa garantido.";
  }
  if (st === "PAUSED") {
    return "Objeto criado PAUSADO. A aprovacao criou o objeto e nao iniciou entrega nem gasto. Para entregar, o gestor ativa no Gerenciador.";
  }
  return `Objeto criado com status ${st}. Este lembrete acompanha o status_inicial do payload.`;
}

export function lembreteCasaComStatus(lembrete: string, statusInicial: string): boolean {
  const st = String(statusInicial ?? "").trim().toUpperCase();
  const t = String(lembrete ?? "");
  if (st === "ACTIVE") return /\bACTIVE\b/.test(t) && !/PAUSADO/.test(t);
  if (st === "PAUSED") return /PAUSADO/.test(t) && !/\bACTIVE\b/.test(t);
  return t.includes(st);
}
