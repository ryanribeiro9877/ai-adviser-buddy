/**
 * Janela minima para LER e ainda emitir o card e escrever a resposta no mesmo bloco HTTP.
 * Mesmo numero de `aindaCabeFerramenta` no traffic-chat: uma leitura (<1s medido), uma rodada
 * de modelo com propose_action e a rodada da prosa.
 */
export const JANELA_MINIMA_LEITURA_DO_ATO_MS = 30_000;

/** So leitura passa: escrita (upload, registro, legenda) e propose_action tem regra propria. */
const RE_FERRAMENTA_DE_LEITURA = /^(get|ler)_/;

/**
 * Depois do prazo de coleta (TOOLS_DEADLINE_MS) o chat recusa toda ferramenta para guardar a
 * janela para a prosa. Num pedido de ATO isso trava: o laco continua chamando o modelo para
 * emitir o card, mas recusa a leitura que o card exige, e o modelo — corretamente — nao copia
 * segmentacao de memoria.
 *
 * O DEFEITO QUE ISTO CONSERTA (15/10/2026, conversa bf4a8869): "crie um novo conjunto com o
 * nome CONJ.4 MELHORES_CRIATIVOS e coloque as mesmas configuracoes ... para publico, para
 * valores defina o 23,00". A primeira chamada do modelo voltou aos ~70s de turno; as sete
 * leituras do bloco (get_estrutura_conjuntos, get_campaign_detail) voltaram "deadline de
 * coleta" sem rodar, em seis rodadas de modelo e ~240k tokens, com 40s ainda livres. No bloco
 * seguinte as mesmas leituras levaram 774ms.
 *
 * Regra: com card ainda por emitir e janela para ler E emitir depois, a leitura roda. Sem card
 * pendente, o prazo de coleta continua valendo — e ele que reserva a janela da prosa.
 */
export function podeLerAposPrazoDeColeta(t: {
  ferramenta: string;
  precisaCard: boolean;
  restanteMs: number;
}): boolean {
  if (!t.precisaCard) return false;
  if (!RE_FERRAMENTA_DE_LEITURA.test(String(t.ferramenta ?? ""))) return false;
  return t.restanteMs > JANELA_MINIMA_LEITURA_DO_ATO_MS;
}
