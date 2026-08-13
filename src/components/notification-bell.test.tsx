import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Notificacoes, ItemNotificacao } from "@/lib/notificacoes";

// O sino. As regras que valem prender sao todas sobre nao mentir no numero e nao
// oferecer acao que a RLS vai recusar: o badge nunca mostra "0", vermelho so com
// critico, e a acao rapida de resolver aparece apenas para ALERTA, apenas para
// admin e apenas quando o grupo tem um item so.

const irParaMock = vi.fn();
const recarregarMock = vi.fn();
const logAuditMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const updateEqMock = vi.fn();

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2" } as { id: string; name: string } | null,
  isAdmin: true,
};
let notif: {
  dados: Notificacoes;
  carregando: boolean;
  erro: string | null;
  pedidoDeAbrir: number;
};
let erroDoUpdate: unknown = null;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
  logAudit: (...a: unknown[]) => logAuditMock(...a),
}));

vi.mock("@/hooks/use-notificacoes", () => ({
  useNotificacoes: () => ({
    ...notif,
    irPara: irParaMock,
    recarregar: recarregarMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => ({
        eq: (c: string, v: unknown) => {
          updateEqMock(patch, c, v);
          return Promise.resolve({ error: erroDoUpdate });
        },
      }),
    }),
  },
}));

import { NotificationBell } from "./notification-bell";

function item(over: Partial<ItemNotificacao> = {}): ItemNotificacao {
  return {
    id: "n1",
    tipo: "aprovacao",
    titulo: "Escalar orçamento",
    descricao: "Primeira linha\nsegunda",
    urgencia: "medium",
    created_at: "2026-08-13T11:00:00Z",
    expires_at: null,
    minutos_para_expirar: null,
    conversation_id: null,
    ...over,
  };
}

function dados(itens: ItemNotificacao[], over: Partial<Notificacoes> = {}): Notificacoes {
  return {
    total: itens.length,
    aprovacoes_pendentes: itens.filter((i) => i.tipo === "aprovacao").length,
    alertas_abertos: itens.filter((i) => i.tipo === "alerta").length,
    criticos: 0,
    expirando_em_2h: 0,
    itens,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  irParaMock.mockReset();
  recarregarMock.mockReset();
  logAuditMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  updateEqMock.mockReset();
  erroDoUpdate = null;
  ctx = { selectedCompany: { id: "c1", name: "JCR2" }, isAdmin: true };
  notif = { dados: dados([]), carregando: false, erro: null, pedidoDeAbrir: 0 };
});

/** Abre o sino. */
async function abrir() {
  await userEvent.click(screen.getByRole("button", { name: /Notificações/ }));
}

describe("badge", () => {
  it("NAO existe quando nao ha pendencia — nunca mostrar '0'", () => {
    // Badge com zero e ruido visual que ensina a ignorar o sino.
    notif.dados = dados([]);
    render(<NotificationBell />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("mostra a contagem quando ha pendencia", () => {
    notif.dados = dados([item({ id: "a" }), item({ id: "b" })]);
    render(<NotificationBell />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("acima de 99 mostra '99+' em vez de estourar a largura", () => {
    notif.dados = dados([item()], { total: 150 });
    render(<NotificationBell />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("fica VERMELHO so quando ha critico", () => {
    notif.dados = dados([item()], { total: 1, criticos: 1 });
    render(<NotificationBell />);
    expect(screen.getByText("1").className).toContain("bg-destructive");
  });

  it("sem critico usa a cor de atencao, nao a de perigo", () => {
    notif.dados = dados([item()], { total: 1, criticos: 0 });
    render(<NotificationBell />);
    expect(screen.getByText("1").className).not.toContain("bg-destructive");
  });
});

describe("acessibilidade do gatilho", () => {
  it("anuncia a quantidade para leitor de tela", () => {
    notif.dados = dados([item({ id: "a" }), item({ id: "b" })]);
    render(<NotificationBell />);
    expect(
      screen.getByRole("button", { name: "Notificações: 2 pendência(s)" }),
    ).toBeInTheDocument();
  });

  it("anuncia a ausencia de pendencia", () => {
    render(<NotificationBell />);
    expect(
      screen.getByRole("button", { name: "Notificações: nenhuma pendência" }),
    ).toBeInTheDocument();
  });

  it("fica desabilitado sem empresa selecionada", () => {
    ctx = { selectedCompany: null, isAdmin: true };
    render(<NotificationBell />);
    expect(screen.getByRole("button", { name: /Notificações/ })).toBeDisabled();
  });
});

describe("conteúdo do sino", () => {
  it("carregando mostra o estado de carga", async () => {
    notif = { ...notif, carregando: true };
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText(/Carregando/)).toBeInTheDocument();
  });

  it("erro aparece com a mensagem, em vez de lista vazia", async () => {
    // Vazio silencioso faria o gestor achar que nao ha pendencia.
    notif = { ...notif, erro: "permission denied" };
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });

  it("vazio diz que esta vazio", async () => {
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText("Nenhuma pendência agora.")).toBeInTheDocument();
  });

  it("mostra a quebra por tipo no cabecalho", async () => {
    notif.dados = dados([item({ id: "a" }), item({ id: "b", tipo: "alerta" })]);
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText(/1 aprovação\(ões\) · 1 alerta\(s\)/)).toBeInTheDocument();
  });

  it("lista titulo e primeira linha da descricao", async () => {
    notif.dados = dados([item()]);
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText("Escalar orçamento")).toBeInTheDocument();
    // Só a primeira linha: a segunda ficaria ruído num menu estreito.
    expect(screen.getByText("Primeira linha")).toBeInTheDocument();
  });

  it("agrupa itens de mesmo titulo e mostra o multiplicador", async () => {
    notif.dados = dados([
      item({ id: "a", titulo: "Jobs internos com falha" }),
      item({ id: "b", titulo: "Jobs internos com falha" }),
    ]);
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText("×2")).toBeInTheDocument();
  });

  it("item unico nao recebe multiplicador", async () => {
    notif.dados = dados([item()]);
    render(<NotificationBell />);
    await abrir();
    expect(screen.queryByText("×1")).not.toBeInTheDocument();
  });

  it("mostra o prazo de aprovacao e destaca o urgente", async () => {
    notif.dados = dados([item({ expires_at: "2026-08-13T13:00:00Z" })]);
    render(<NotificationBell />);
    await abrir();
    const prazo = await screen.findByText("expira em 1h");
    expect(prazo.className).toContain("text-destructive");
  });

  it("prazo longo nao usa a cor de urgencia", async () => {
    notif.dados = dados([item({ expires_at: "2026-08-14T12:00:00Z" })]);
    render(<NotificationBell />);
    await abrir();
    expect((await screen.findByText("expira em 24h")).className).not.toContain("text-destructive");
  });

  it("ALERTA nao mostra prazo (prazo e conceito de aprovacao)", async () => {
    notif.dados = dados([item({ tipo: "alerta", expires_at: "2026-08-13T13:00:00Z" })]);
    render(<NotificationBell />);
    await abrir();
    await screen.findByText("Escalar orçamento");
    expect(screen.queryByText(/expira em/)).not.toBeInTheDocument();
  });

  it("oferece o caminho para a tela completa", async () => {
    render(<NotificationBell />);
    await abrir();
    expect((await screen.findByText("Ver todos os alertas")).closest("a")).toHaveAttribute(
      "href",
      "/alertas",
    );
  });
});

describe("navegar a partir do sino", () => {
  it("clicar no item leva ao destino dele", async () => {
    notif.dados = dados([item({ id: "p9" })]);
    render(<NotificationBell />);
    await abrir();
    await userEvent.click(await screen.findByText("Escalar orçamento"));
    await waitFor(() => expect(irParaMock).toHaveBeenCalled());
    expect(irParaMock.mock.calls[0][0].id).toBe("p9");
  });
});

describe("ação rápida de resolver", () => {
  const alerta = item({ id: "al1", tipo: "alerta", titulo: "CPL acima do teto" });

  it("aparece para ALERTA de admin com grupo de um", async () => {
    notif.dados = dados([alerta]);
    render(<NotificationBell />);
    await abrir();
    expect(await screen.findByText(/Resolver CPL acima do teto/)).toBeInTheDocument();
  });

  it("NAO aparece para aprovacao — aprovar exige o contexto completo", async () => {
    notif.dados = dados([item({ tipo: "aprovacao" })]);
    render(<NotificationBell />);
    await abrir();
    await screen.findByText("Escalar orçamento");
    expect(screen.queryByText(/^Resolver /)).not.toBeInTheDocument();
  });

  it("NAO aparece para nao-admin (a RLS recusaria o UPDATE)", async () => {
    // Oferecer o botao e deixar a RLS recusar seria falhar em silencio.
    ctx = { ...ctx, isAdmin: false };
    notif.dados = dados([alerta]);
    render(<NotificationBell />);
    await abrir();
    await screen.findByText("CPL acima do teto");
    expect(screen.queryByText(/^Resolver /)).not.toBeInTheDocument();
  });

  it("NAO aparece em grupo com mais de um (resolveria so um deles)", async () => {
    notif.dados = dados([
      item({ id: "a", tipo: "alerta", titulo: "Mesmo titulo" }),
      item({ id: "b", tipo: "alerta", titulo: "Mesmo titulo" }),
    ]);
    render(<NotificationBell />);
    await abrir();
    await screen.findByText("×2");
    expect(screen.queryByText(/^Resolver /)).not.toBeInTheDocument();
  });

  it("resolve o alerta certo, audita e recarrega", async () => {
    notif.dados = dados([alerta]);
    render(<NotificationBell />);
    await abrir();
    await userEvent.click(await screen.findByText(/Resolver CPL acima do teto/));
    await waitFor(() => expect(updateEqMock).toHaveBeenCalledWith({ resolved: true }, "id", "al1"));
    expect(logAuditMock).toHaveBeenCalledWith({
      companyId: "c1",
      action: "alert.resolve",
      targetType: "alert",
      targetId: "al1",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Alerta resolvido");
    expect(recarregarMock).toHaveBeenCalled();
  });

  it("erro no update avisa e NAO audita nem recarrega", async () => {
    // Auditar algo que nao aconteceu seria pior que nao auditar.
    erroDoUpdate = { message: "permission denied" };
    notif.dados = dados([alerta]);
    render(<NotificationBell />);
    await abrir();
    await userEvent.click(await screen.findByText(/Resolver CPL acima do teto/));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível resolver: permission denied"),
    );
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(recarregarMock).not.toHaveBeenCalled();
  });
});

describe("abertura automática pelo toast agrupado", () => {
  it("pedidoDeAbrir > 0 abre o sino", async () => {
    notif = { ...notif, pedidoDeAbrir: 1, dados: dados([item()]) };
    render(<NotificationBell />);
    // Sem clicar: o toast agrupado pediu para abrir.
    expect(await screen.findByText("Pendências")).toBeInTheDocument();
  });

  it("pedidoDeAbrir zero mantem fechado", () => {
    notif = { ...notif, pedidoDeAbrir: 0, dados: dados([item()]) };
    render(<NotificationBell />);
    expect(screen.queryByText("Pendências")).not.toBeInTheDocument();
  });
});
