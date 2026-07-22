// Feature-flags do front. Mudanças de escopo/rollout de menus e telas passam
// por aqui — assim o código não é deletado, só ocultado, e volta ligando a flag.
export const FEATURES = {
  // Fase 0: o fluxo de aprovações vai renascer dentro do chat "Operação" (Fase 3).
  // Até lá, o menu fica oculto (rota preservada e acessível por URL).
  approvalsMenu: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
