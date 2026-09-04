import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FalhaDeCarga } from "./falha-de-carga";

// Este componente e a correcao de um defeito que apareceu em sete telas: erro de
// consulta renderizado como estado legitimo ("nenhum pedido", "nenhuma
// empresa"). Ele so cumpre esse papel se garantir DUAS coisas — que se anuncia
// como falha, e que da uma saida. Sem a segunda, o gestor precisa recarregar a
// pagina para descobrir se ainda esta quebrado.

describe("FalhaDeCarga — se identifica como falha", () => {
  it("nomeia o que nao carregou, em vez de erro genérico", () => {
    render(<FalhaDeCarga oQue="os pedidos de aprovação" onTentarDeNovo={() => {}} />);
    expect(
      screen.getByText(/não foi possível carregar os pedidos de aprovação/i),
    ).toBeInTheDocument();
  });

  it("diz explicitamente que NAO e lista vazia", () => {
    // A frase existe para o gestor nao concluir o de sempre. Se alguem tirar
    // isto, o card volta a poder ser lido como "nao ha nada".
    render(<FalhaDeCarga oQue="as metas" onTentarDeNovo={() => {}} />);
    expect(screen.getByText(/não uma lista vazia/i)).toBeInTheDocument();
  });

  it("e anunciado a leitor de tela como alerta", () => {
    render(<FalhaDeCarga oQue="as metas" onTentarDeNovo={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("mostra a causa quando ha uma", () => {
    render(
      <FalhaDeCarga
        oQue="as conversas"
        erro={{ message: "permission denied" }}
        onTentarDeNovo={() => {}}
      />,
    );
    expect(screen.getByText(/motivo: permission denied/i)).toBeInTheDocument();
  });

  it("sem causa utilizavel, omite o motivo em vez de escrever 'undefined'", () => {
    render(<FalhaDeCarga oQue="as conversas" erro={{}} onTentarDeNovo={() => {}} />);
    expect(screen.queryByText(/motivo:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined|\[object Object\]/)).not.toBeInTheDocument();
  });
});

describe("FalhaDeCarga — oferece saida", () => {
  it("tentar de novo chama o callback", async () => {
    const tentar = vi.fn();
    render(<FalhaDeCarga oQue="as metas" onTentarDeNovo={tentar} />);
    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("a versao compacta tambem oferece tentar de novo", async () => {
    // A compacta vive em menu e barra lateral, onde o card grande nao cabe. Uma
    // versao sem saida seria meia correcao.
    const tentar = vi.fn();
    render(<FalhaDeCarga compacto oQue="as empresas" onTentarDeNovo={tentar} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/não foi possível carregar as empresas/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(tentar).toHaveBeenCalledTimes(1);
  });
});
