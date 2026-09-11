import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import type { CampanhaRelatorio } from "@/lib/relatorios";
import {
  FormularioMissao,
  formVazioMissao,
  type FormMissaoRitmo,
} from "./formulario-missao";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

function campanha(
  p: Partial<CampanhaRelatorio> & Pick<CampanhaRelatorio, "external_id" | "nome" | "status">,
): CampanhaRelatorio {
  return {
    objective: null,
    tipo: null,
    gasto: 0,
    last_synced_at: null,
    fonte: "ao_vivo",
    ...p,
  };
}

const ativas: CampanhaRelatorio[] = [
  campanha({ external_id: "120", nome: "Consignado SP", status: "ACTIVE" }),
  campanha({ external_id: "99", nome: "Pausada velha", status: "PAUSED" }),
];

function valido(patch: Partial<FormMissaoRitmo> = {}): FormMissaoRitmo {
  return {
    campaignId: "120",
    campaignName: "Consignado SP",
    adAccountId: "",
    periodoInicio: "2026-09-11",
    periodoFim: "2026-09-20",
    metrica: "conversas",
    dissertacao: "subir conversas no prazo",
    sonho: "",
    extra: "",
    ...patch,
  };
}

function Harness({
  inicial,
  isAdmin = true,
  avisoFonte = null,
  fonteCampanhas = "ao_vivo",
  onSubmit,
  ocupado = false,
}: {
  inicial: FormMissaoRitmo;
  isAdmin?: boolean;
  avisoFonte?: string | null;
  fonteCampanhas?: "ao_vivo" | "espelho";
  onSubmit?: (form: FormMissaoRitmo) => void;
  ocupado?: boolean;
}) {
  const [form, setForm] = useState(inicial);
  return (
    <FormularioMissao
      form={form}
      onChange={setForm}
      campanhas={ativas}
      fonteCampanhas={fonteCampanhas}
      avisoFonte={avisoFonte}
      carregandoCampanhas={false}
      onRecarregarCampanhas={() => {}}
      isAdmin={isAdmin}
      onSubmit={onSubmit}
      ocupado={ocupado}
    />
  );
}

function montar(el: ReactNode) {
  return render(el);
}

beforeEach(() => {
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("FormularioMissao", () => {
  it("recusa dissertação vazia em português", async () => {
    montar(<Harness inicial={valido({ dissertacao: "" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Descreva o que a força-tarefa deve fazer.");
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("aceita extra em branco (vale 0) e entrega o form ao pai", async () => {
    const onSubmit = vi.fn();
    montar(<Harness inicial={valido({ extra: "" })} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ extra: "", campaignId: "120" }));
  });

  it("recusa extra negativo", async () => {
    montar(<Harness inicial={valido({ extra: "-10" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("O extra de investimento não pode ser negativo.");
  });

  it("recusa sonho inválido", async () => {
    montar(<Harness inicial={valido({ sonho: "0" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith(
      "O sonho, se informado, precisa ser maior que zero.",
    );
  });

  it("recusa prazo maior que 90 dias", async () => {
    montar(<Harness inicial={valido({ periodoInicio: "2026-09-10", periodoFim: "2026-12-20" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("O prazo precisa ter entre 1 e 90 dias.");
  });

  it("recusa métrica desconhecida", async () => {
    montar(<Harness inicial={valido({ metrica: "leads" })} />);
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Escolha uma métrica válida.");
  });

  it("oculta campanha pausada e mostra só ativas", () => {
    montar(<Harness inicial={formVazioMissao()} />);
    expect(screen.getByRole("option", { name: "Consignado SP" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Pausada velha" })).not.toBeInTheDocument();
  });

  it("mostra aviso da fonte espelho", () => {
    montar(
      <Harness
        inicial={formVazioMissao()}
        fonteCampanhas="espelho"
        avisoFonte="Lista do último sync local, não da Graph agora. O relatório tenta o ao vivo na hora de rodar."
      />,
    );
    expect(screen.getByText(/último sync local/i)).toBeInTheDocument();
    expect(screen.getByText("espelho local")).toBeInTheDocument();
  });

  it("sufixo do sonho muda com a métrica", async () => {
    montar(<Harness inicial={valido({ metrica: "conversas" })} />);
    expect(screen.getByText("unid.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Métrica"), "ctr");
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("visualizador vê o formulário só leitura, sem enviar", () => {
    montar(<Harness inicial={valido()} isAdmin={false} />);
    expect(screen.queryByRole("button", { name: "Criar força-tarefa" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dissertação")).toBeDisabled();
  });

  it("desabilita criar força-tarefa enquanto ocupa a fila", async () => {
    const onSubmit = vi.fn();
    montar(<Harness inicial={valido()} ocupado onSubmit={onSubmit} />);
    const botao = screen.getByRole("button", { name: "Criar força-tarefa" });
    expect(botao).toBeDisabled();
    await userEvent.click(botao);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
