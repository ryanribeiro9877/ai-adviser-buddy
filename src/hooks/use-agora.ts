import { useEffect, useState } from "react";

/**
 * Relógio local para textos que envelhecem sozinhos ("há 2h", "expira em 3h").
 * Não é polling de dados: nada é lido do banco, só o horário do navegador.
 */
export function useAgora(ativo = true, intervaloMs = 30_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [ativo, intervaloMs]);
  return agora;
}
