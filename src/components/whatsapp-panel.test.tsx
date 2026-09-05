import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

const fail = { data: null, error: { message: "permission denied for table waba_phone_numbers" } };

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const p = Promise.resolve(fail);
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => p;
  chain.gte = () => chain;
  chain.then = (onF: unknown, onR: unknown) => (p as Promise<unknown>).then(onF as never, onR as never);
  return {
    supabase: {
      rpc: () => Promise.resolve({ data: null, error: null }),
      from: () => chain,
    },
  };
});

vi.mock("@/lib/xlsx-export", () => ({ exportarXlsx: vi.fn() }));

import { WhatsAppPanel } from "./whatsapp-panel";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return render(<WhatsAppPanel companyId="c1" />, { wrapper: Wrapper });
}

describe("falha de consulta nao e 'nada conectado'", () => {
  it("FALHA se identifica como falha, com opcao de tentar de novo", async () => {
    montar();
    expect(
      await screen.findByText(/não foi possível carregar as contas de WhatsApp desta empresa/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma conta de WhatsApp Business conectada/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
  });
});
