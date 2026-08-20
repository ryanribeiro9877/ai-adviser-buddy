import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";

const userEvent = userEventBase.setup({ delay: null });

// O cartao de progresso do job assincrono. A propriedade que define este arquivo
// esta documentada no proprio componente (GT-16): a TELA NAO DECIDE POR TEMPO.
// Quem diz se o job morreu e a linha em chat_jobs. O relogio anterior, de 7 min,
// reprovava job vivo - o job seguia rodando e terminava com sucesso no servidor
// enquanto a tela ja dizia que falhou.
//
// O tempo de silencio existe, mas como REDE DE SEGURANCA: informa e oferece
// saida, sem afirmar que falhou. Os testes abaixo protegem essa distincao.

// created_at SEMPRE presente: e como a linha real vem do banco, e sem ele o
// carimbo de avanco cai no Date.now() do instante em que a leitura assincrona
// resolve — que, sob relogio falso ja adiantado, zeraria o silencio acumulado.
let linha: Record<string, unknown> = {
  status: "running",
  progresso: [],
  erro: null,
  created_at: "2026-08-13T12:00:00Z",
};
let handlerRealtime: ((p: { new: unknown }) => void) | null = null;
let nomeDoCanal = "";
let filtro = "";
const removeChannelMock = vi.fn();
const subscribeMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        selectMock(cols);
        // `data` é um GETTER de propósito. Com `{ data: linha }` a referência
        // seria capturada no momento da chamada, e a leitura inicial (assíncrona)
        // resolveria DEPOIS de um evento de Realtime disparado pelo teste,
        // sobrescrevendo o estado novo com a linha velha. O getter faz a leitura
        // devolver sempre o estado corrente, e a ordem deixa de importar.
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                get data() {
                  return linha;
                },
              }),
          }),
        };
      },
    }),
    channel: (nome: string) => {
      nomeDoCanal = nome;
      const canal = {
        on: (_e: string, cfg: { filter: string }, cb: (p: { new: unknown }) => void) => {
          filtro = cfg.filter;
          handlerRealtime = cb;
          return canal;
        },
        subscribe: () => {
          subscribeMock();
          return canal;
        },
      };
      return canal;
    },
    removeChannel: (...a: unknown[]) => removeChannelMock(...a),
  },
}));

import { JobProgressCard } from "./job-progress-card";

function montar(props: Record<string, unknown> = {}) {
  const onDone = vi.fn();
  const onResend = vi.fn();
  const r = render(
    <JobProgressCard jobId="job-1" onDone={onDone} onResend={onResend} {...props} />,
  );
  return { ...r, onDone, onResend };
}

/** Empurra uma atualização da linha pelo Realtime. */
function chegaDoBanco(nova: Record<string, unknown>) {
  act(() => {
    linha = { ...linha, ...nova };
    handlerRealtime?.({ new: linha });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  linha = {
    status: "running",
    progresso: [],
    erro: null,
    created_at: "2026-08-13T12:00:00Z",
  };
  handlerRealtime = null;
  nomeDoCanal = "";
  filtro = "";
  removeChannelMock.mockReset();
  subscribeMock.mockReset();
  selectMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assinatura e releitura", () => {
  it("assina o Realtime FILTRANDO pelo job", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    expect(nomeDoCanal).toBe("chat-job-job-1");
    expect(filtro).toBe("id=eq.job-1");
  });

  it("LE a linha ao montar — o job pode ter avançado antes de assinarmos", async () => {
    montar();
    await waitFor(() => expect(selectMock).toHaveBeenCalled());
    expect(selectMock.mock.calls[0][0]).toContain("status");
  });

  it("reconfere o banco a cada 20s — lastro de um UPDATE perdido pelo socket", async () => {
    // Sem a releitura, um UPDATE perdido deixaria o card girando para sempre
    // sobre um job que ja terminou.
    montar();
    await waitFor(() => expect(selectMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(selectMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("remove o canal ao desmontar", async () => {
    const { unmount } = montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });
});

describe("fases", () => {
  it("mostra as três fases da resposta completa", async () => {
    montar();
    expect(await screen.findByText("Planejando")).toBeInTheDocument();
    expect(screen.getByText("Especialistas trabalhando")).toBeInTheDocument();
    expect(screen.getByText("Escrevendo resposta")).toBeInTheDocument();
  });

  it("usa rótulo NEUTRO — o card cobre o toggle do gestor e o automático", async () => {
    // Dizer "análise profunda" no caminho automático atribuiria ao gestor uma
    // escolha que não foi dele; a linha de chat_jobs é idêntica nos dois.
    montar();
    expect(await screen.findByText("Preparando a resposta completa")).toBeInTheDocument();
  });

  it("a fase ATUAL vem do último passo recebido", async () => {
    montar();
    await screen.findByText("Planejando");
    chegaDoBanco({ progresso: [{ fase: "planner" }, { fase: "sintese" }] });
    await waitFor(() => {
      const escrevendo = screen.getByText("Escrevendo resposta");
      expect(escrevendo.className).toContain("text-foreground");
    });
  });

  it("fase desconhecida não quebra a lista", async () => {
    montar();
    chegaDoBanco({ progresso: [{ fase: "fase_inventada" }] });
    await waitFor(() => expect(screen.getByText("Planejando")).toBeInTheDocument());
  });

  it("devolucao e segmento NAO voltam o spinner para Planejando", async () => {
    // Bug medido 20/08: ultimo passo "segmento: retomando do checkpoint" fazia
    // findIndex=-1 → Math.max(0,-1)=0 → card preso em Planejando com tags Criativos/Alertas.
    montar();
    chegaDoBanco({
      progresso: [
        { fase: "planner", detalhe: "especialistas: criativos, alertas_recomendacoes" },
        { fase: "subagentes", detalhe: "relatorios prontos" },
        { fase: "devolucao", detalhe: "rodada 1: criativos" },
        { fase: "segmento", detalhe: "segmento 2: retomando do checkpoint" },
      ],
    });
    await waitFor(() => {
      const esp = screen.getByText("Especialistas trabalhando");
      expect(esp.className).toContain("text-foreground");
    });
    const planejando = screen.getByText("Planejando");
    expect(planejando.className).toContain("text-muted-foreground");
  });

  it("progresso que não é lista é tratado como vazio", async () => {
    montar();
    chegaDoBanco({ progresso: { nao: "e lista" } });
    await waitFor(() => expect(screen.getByText("Planejando")).toBeInTheDocument());
  });
});

describe("especialistas", () => {
  it("traduz os nomes técnicos para rótulo de gestor", async () => {
    montar();
    chegaDoBanco({
      progresso: [{ fase: "subagentes", detalhe: "especialistas: criativos, whatsapp_waba" }],
    });
    expect(await screen.findByText("Criativos")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("ignora sufixo de plano padrao no chip (nao vaza texto tecnico)", async () => {
    montar();
    chegaDoBanco({
      progresso: [{
        fase: "planner",
        detalhe: "especialistas: desempenho_campanhas, criativos (plano padrao - planejador nao devolveu JSON valido) [lite]",
      }],
    });
    expect(await screen.findByText("Desempenho")).toBeInTheDocument();
    expect(screen.getByText("Criativos")).toBeInTheDocument();
    expect(screen.queryByText(/plano padrao/i)).not.toBeInTheDocument();
  });

  it("o detalhe de especialistas NÃO é repetido como texto solto", async () => {
    // Ele já virou chip; repetir a string técnica embaixo seria ruído.
    montar();
    chegaDoBanco({ progresso: [{ fase: "subagentes", detalhe: "especialistas: criativos" }] });
    await screen.findByText("Criativos");
    expect(screen.queryByText(/^especialistas:/)).not.toBeInTheDocument();
  });

  it("detalhe comum aparece como texto", async () => {
    montar();
    chegaDoBanco({ progresso: [{ fase: "sintese", detalhe: "montando o resumo" }] });
    expect(await screen.findByText("montando o resumo")).toBeInTheDocument();
  });
});

describe("o BANCO decide — não o relógio", () => {
  it("status=error mostra a falha com o motivo que o banco deu", async () => {
    montar();
    chegaDoBanco({ status: "error", erro: "O worker foi reiniciado durante a análise." });
    expect(await screen.findByText("A resposta não foi concluída")).toBeInTheDocument();
    // O texto do expira-chat-jobs explica melhor do que "tempo esgotado" explicaria.
    expect(screen.getByText("O worker foi reiniciado durante a análise.")).toBeInTheDocument();
  });

  it("erro sem mensagem ainda diz que parou", async () => {
    montar();
    chegaDoBanco({ status: "error", erro: null });
    expect(await screen.findByText("O processamento parou antes de concluir.")).toBeInTheDocument();
  });

  it("na falha, oferece REENVIAR", async () => {
    const { onResend } = montar();
    chegaDoBanco({ status: "error", erro: "x" });
    await userEvent.click(await screen.findByRole("button", { name: /Reenviar/ }));
    expect(onResend).toHaveBeenCalled();
  });

  it("status=done: o card SAI de cena e avisa o pai", async () => {
    // Ele se remove sozinho; depender so do evento de chat_messages deixaria o
    // card girando sobre um job ja pronto se o evento se perdesse.
    const { onDone, container } = montar();
    chegaDoBanco({ status: "done" });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(onDone).toHaveBeenCalled();
  });

  it("job LONGO mas ativo NÃO é reprovado pela tela", async () => {
    // O caso que motivou o GT-16: 10 minutos rodando, emitindo fase. O relogio
    // antigo (7 min) chamava isso de falha enquanto o servidor terminava bem.
    montar();
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
      await Promise.resolve();
    });
    expect(screen.queryByText("A resposta não foi concluída")).not.toBeInTheDocument();
    expect(screen.getByText("Preparando a resposta completa")).toBeInTheDocument();
  });
});

describe("silêncio — rede de segurança, não veredito", () => {
  it("antes de 15 min de silêncio, nada é dito", async () => {
    montar();
    await act(async () => {
      vi.advanceTimersByTime(14 * 60 * 1000);
      await Promise.resolve();
    });
    expect(screen.queryByText(/sem resposta do servidor/)).not.toBeInTheDocument();
  });

  it("passados 15 min sem avanço, INFORMA sem afirmar que falhou", async () => {
    // A redacao importa: "ainda processando" e nao "falhou" - o job pode estar
    // terminando neste instante, e o veredito continua sendo do banco.
    montar();
    await act(async () => {
      vi.advanceTimersByTime(16 * 60 * 1000);
      await Promise.resolve();
    });
    expect(await screen.findByText(/Ainda processando/)).toBeInTheDocument();
    expect(screen.queryByText("A resposta não foi concluída")).not.toBeInTheDocument();
  });

  it("oferece saída (reenviar) junto com o aviso de silêncio", async () => {
    const { onResend } = montar();
    await act(async () => {
      vi.advanceTimersByTime(16 * 60 * 1000);
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole("button", { name: /Reenviar/ }));
    expect(onResend).toHaveBeenCalled();
  });

  it("AVANÇO zera o silêncio — job que emite fase segue vivo", async () => {
    // Conta silencio, nao tempo total: e o que permite job longo terminar em paz.
    montar();
    await act(async () => {
      vi.advanceTimersByTime(14 * 60 * 1000);
      await Promise.resolve();
    });
    // O passo carrega `em`: é dele que sai o carimbo do avanço (a linha diz
    // quando avançou, não o relógio do navegador — reabrir a conversa não pode
    // zerar o silêncio acumulado de um job que já estava parado).
    chegaDoBanco({ progresso: [{ fase: "subagentes", em: "2026-08-13T12:14:00Z" }] });
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
    });
    // 19 min de job, mas so 5 desde o ultimo avanco.
    expect(screen.queryByText(/sem resposta do servidor/)).not.toBeInTheDocument();
  });
});
