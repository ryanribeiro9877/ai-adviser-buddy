import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BibliotecaDeCriativos } from "./biblioteca-de-criativos";
import type { AtivoOrfao, ListaDeAtivos } from "@/lib/ativos-orfaos";

function ativo(over: Partial<AtivoOrfao> = {}): AtivoOrfao {
  return {
    tipo: "video",
    id: "1",
    nome: "peca.mp4",
    motivo: "nunca_usado",
    anuncios: [],
    ultimo_gasto_em: null,
    gasto_total: 0,
    bloqueado_por: null,
    duplicata_de: null,
    candidato: true,
    ...over,
  };
}

function lista(ativos: AtivoOrfao[], over: Partial<ListaDeAtivos> = {}): ListaDeAtivos {
  return {
    ok: true,
    account_id: "1622612945584817",
    dias_sem_uso: 90,
    videos: ativos.length,
    imagens: 0,
    anuncios: 0,
    miniaturas_nossas: 24,
    miniaturas_faltando: 200,
    faxina_adiada_ate: "2026-10-09",
    aprendizado_desconhecido: false,
    ativos,
    ...over,
  };
}

describe("biblioteca de criativos", () => {
  it("mostra o motivo, o arquivo e qual duplicata fica", () => {
    render(
      <BibliotecaDeCriativos
        dias={90}
        onDias={vi.fn()}
        lista={lista([
          ativo({
            id: "999",
            nome: "01. Setembro.mp4",
            motivo: "duplicata",
            duplicata_de: "1596865345181641",
          }),
          ativo({
            id: "1596865345181641",
            nome: "01. Setembro.mp4",
            motivo: null,
            bloqueado_por: "em_uso",
            candidato: false,
            anuncios: [{ id: "ad1", nome: "LAF conjunto 1" }],
          }),
        ])}
      />,
    );
    expect(screen.getByText("Duplicata")).toBeInTheDocument();
    expect(screen.getByText(/Fica 01\. Setembro\.mp4/)).toBeInTheDocument();
    expect(screen.getByText(/fica 1596865345181641/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /arquivar|excluir|limpar/i })).toBeNull();
  });

  it("não oferece seleção de arquivo bloqueado e avisa gasto recente", () => {
    render(
      <BibliotecaDeCriativos
        dias={90}
        onDias={vi.fn()}
        lista={lista([
          ativo({
            id: "888",
            nome: "agosto.mp4",
            motivo: "anuncio_inativo",
            ultimo_gasto_em: new Date().toISOString().slice(0, 10),
            gasto_total: 12,
            anuncios: [{ id: "a", nome: "Piscina" }],
          }),
        ])}
      />,
    );
    expect(screen.getByText(/A exclusão não entra enquanto isso aparecer/)).toBeInTheDocument();
    expect(screen.getByText(/Faltam 200 capas/)).toBeInTheDocument();
    expect(screen.getByText(/não roda antes de/)).toBeInTheDocument();
    const caixa = screen.getByRole("checkbox", { name: /agosto\.mp4/ });
    expect(caixa).not.toBeDisabled();
    fireEvent.click(caixa);
    expect(screen.getByText(/1 de 25 selecionados/)).toBeInTheDocument();
  });
});
