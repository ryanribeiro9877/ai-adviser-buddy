import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecomendacaoCard } from "./recomendacao-card";

describe("RecomendacaoCard", () => {
  it("mostra assunto, proposta e opinião — sem jargão da API", () => {
    render(
      <RecomendacaoCard
        reco={{
          id: "1",
          status: "new",
          title: "Meta: Opportunity Score da conta: 97",
          description:
            "A Graph devolveu opportunity_score=97. Veredito interno: SEM_REGUA -- Nenhuma doutrina/RPC.",
          impact: "low",
          family: "meta_dica",
          signal_key: "meta.dica.opportunity_score.snapshot",
          entity_type: "account",
          entity_name: "act_1622612945584817",
          maturity_days: 0,
          evidence_json: { veredito: "sem_regua", opportunity_score: 97, first_seen_on: "2026-09-11" },
        }}
        onChat={vi.fn()}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/a meta deu nota 97/i)).toBeInTheDocument();
    expect(screen.getByText("Do que se trata")).toBeInTheDocument();
    expect(screen.getByText("O que a Meta pediu")).toBeInTheDocument();
    expect(screen.getByText("Opinião do SuperGestor")).toBeInTheDocument();
    expect(screen.getByText(/não precisa agir/i)).toBeInTheDocument();
    expect(screen.queryByText(/SEM_REGUA/)).not.toBeInTheDocument();
    expect(screen.queryByText(/opportunity_score=/i)).not.toBeInTheDocument();
    expect(screen.queryByText("low")).not.toBeInTheDocument();
    expect(screen.queryByText(/meta\.dica/)).not.toBeInTheDocument();
  });

  it("fadiga fala em anúncio cansado e prioridade alta", () => {
    render(
      <RecomendacaoCard
        reco={{
          id: "2",
          status: "new",
          title: "Criativo com sinal de fadiga: PECA",
          description: "CTR de link caiu. [auto: detector]",
          impact: "high",
          family: "criativo_fadiga",
          signal_key: "fadiga.ctr_freq",
          entity_type: "ad",
          entity_name: "PECA",
          maturity_days: 9,
          evidence_json: {
            ctr_link_ultimo: 0,
            ctr_link_base_3d: 0.97,
            frequencia_ultimo: 1.47,
            frequencia_base: 1.13,
          },
        }}
        onChat={vi.fn()}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/cansando o público/i)).toBeInTheDocument();
    expect(screen.getByText("Prioridade alta")).toBeInTheDocument();
    expect(screen.getByText("Fadiga de criativo")).toBeInTheDocument();
    expect(screen.getByText(/vale olhar/i)).toBeInTheDocument();
    expect(screen.queryByText("fadiga.ctr_freq")).not.toBeInTheDocument();
    expect(screen.queryByText("[auto: detector]")).not.toBeInTheDocument();
  });
});
