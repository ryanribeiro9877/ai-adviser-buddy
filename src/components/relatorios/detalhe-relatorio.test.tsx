import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetalheRelatorio, type RelatorioGerado } from "./detalhe-relatorio";

const base: RelatorioGerado = {
  id: "r1",
  nome: "Diário operacional",
  status: "done",
  fonte_campanhas: "ao_vivo",
  campaign_ids_resolvidos: ["120249788950400182"],
  periodo_inicio: "2026-09-09",
  periodo_fim: "2026-09-09",
  corpo_md: "## resumo_executivo\nÚnica campanha do contrato, **sem série** de desempenho.",
  achados: [
    {
      tipo: "monitoramento_reforcado",
      nivel: "campanha",
      alvo_id: "120249788950400182",
      alvo_nome: "COHAPM jurídico",
      severidade: "atencao",
      evidencia: "desempenho_campanhas falhou (openrouter_timeout); gasto R$ 135,88",
      mecanismo: "Sem insights de campanha.",
      acao: "Não executar. Recoletar conjuntos.",
      metrica_sucesso: "Série da campanha na mesma janela.",
      janela_leitura: "Próxima coleta da janela fechada.",
      reversa: "Se os insights vierem completos, este card cai.",
    },
  ],
  cobertura: "effective_status de conjuntos não coletado",
  erro: null,
  criado_em: "2026-09-10T11:00:00Z",
  finalizado_em: "2026-09-10T11:02:00Z",
};

describe("DetalheRelatorio", () => {
  it("mostra título humano, não a chave da seção, e formata o markdown", () => {
    render(<DetalheRelatorio relatorio={base} />);
    expect(screen.getByRole("heading", { name: "Resumo executivo" })).toBeInTheDocument();
    expect(screen.queryByText(/## resumo_executivo/)).not.toBeInTheDocument();
    expect(screen.getByText("sem série", { exact: false })).toBeInTheDocument();
  });

  it("rotula as partes da opinião e esconde jargão de ferramenta", () => {
    render(<DetalheRelatorio relatorio={base} />);
    expect(screen.getByText("Vigiar de perto")).toBeInTheDocument();
    expect(screen.getByText("Atenção")).toBeInTheDocument();
    expect(screen.getByText("Campanha")).toBeInTheDocument();
    expect(screen.getByText("O que vimos")).toBeInTheDocument();
    expect(screen.getByText("O que fazer")).toBeInTheDocument();
    expect(screen.getByText("Por quê")).toBeInTheDocument();
    expect(screen.getByText(/leitura de desempenho/i)).toBeInTheDocument();
    expect(screen.queryByText(/desempenho_campanhas/)).not.toBeInTheDocument();
    expect(screen.getByText("O que não foi medido")).toBeInTheDocument();
    expect(screen.getByText(/status real de conjuntos/i)).toBeInTheDocument();
  });

  it("mostra markdown de dump JSON cortado, não o blob cru", () => {
    render(
      <DetalheRelatorio
        relatorio={{
          ...base,
          corpo_md:
            '{"corpo_md":"## resumo_executivo\\nLa Felicità fechou a janela com o melhor custo.\\n## Ranking de conjuntos\\n| 23 | AD_CONJ.02 |',
          cobertura:
            "Lista de campanhas conferida ao vivo. Falhas: nenhuma. síntese não devolveu JSON válido",
          achados: [],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Resumo executivo" })).toBeInTheDocument();
    expect(screen.getByText(/melhor custo/i)).toBeInTheDocument();
    expect(screen.queryByText(/"corpo_md"/)).not.toBeInTheDocument();
    expect(screen.getByText(/narrativa abaixo foi recuperada/i)).toBeInTheDocument();
  });
});
