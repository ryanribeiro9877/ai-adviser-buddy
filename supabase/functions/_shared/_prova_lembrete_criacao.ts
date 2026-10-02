import { lembreteCasaComStatus, textoLembreteDeCriacao } from "./lembrete_criacao.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const ativo = textoLembreteDeCriacao("ACTIVE");
assert(lembreteCasaComStatus(ativo, "ACTIVE"), "lembrete ACTIVE casa com status_inicial ACTIVE");
assert(!/PAUSADO/.test(ativo), "card ACTIVE nao promete pausa");

const pausado = textoLembreteDeCriacao("PAUSED");
assert(lembreteCasaComStatus(pausado, "PAUSED"), "lembrete PAUSED casa com status_inicial PAUSED");
assert(!/\bACTIVE\b/.test(pausado), "card PAUSED nao promete ativo");

console.log("OK lembrete_criacao");
