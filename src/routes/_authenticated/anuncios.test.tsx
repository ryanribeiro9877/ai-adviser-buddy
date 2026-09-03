import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdRow, CampaignRow, TipoConta } from "@/lib/breakdown";
import { withFilterDefaults, type FilterSearch } from "@/lib/filters";

// Tela de anúncios. Duas coisas a prender:
//   1. o TIPO vem da campanha-mãe — o registro de `ads` não carrega categoria.
//      Sem essa junção, o filtro de tipo não filtraria nada (ou filtraria tudo);
//   2. a tela é ACUMULADA: mostra totais desde o início da conta. Por isso passa
//      mode="accumulated" ao GlobalFilters, que é quem exibe o aviso de que o
//      filtro de período não se aplica aqui.

const NB = " ";

let empresa: { id: string; name: string } | null = { id: "c1", name: "JCR2" };
let busca: FilterSearch = {};
let anuncios: AdRow[] = [];
let campanhas: CampaignRow[] = [];
let carregando = false;
let modoRecebido = "";
let tiposRecebidos: TipoConta[] = [];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ selectedCompany: empresa }) }));

vi.mock("@/hooks/use-filters", () => ({
  useGlobalFilters: () => ({ filters: withFilterDefaults(busca) }),
}));

vi.mock("@/hooks/use-breakdown", () => ({
  useAds: () => ({ data: anuncios, isLoading: carregando }),
  useCampaignBreakdown: () => ({ data: campanhas, isLoading: false }),
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

// A barra de filtros tem teste próprio; aqui só interessa COM QUE parâmetros ela
// é montada — é isso que decide se o aviso de acumulado aparece.
vi.mock("@/components/global-filters", () => ({
  GlobalFilters: ({ mode, typesPresent }: { mode: string; typesPresent: TipoConta[] }) => {
    modoRecebido = mode;
    tiposRecebidos = typesPresent;
    return <div data-testid="filtros" />;
  },
}));

import { Route } from "./anuncios";

const Anuncios = (Route.options as unknown as { component: () => ReactNode }).component;

function anuncio(over: Partial<AdRow> = {}): AdRow {
  return {
    id: "ad1",
    name: "Criativo A",
    status: "ACTIVE",
    object_type: null,
    call_to_action_type: null,
    title: null,
    body: null,
    thumbnail_url: null,
    image_url: null,
    permalink_url: null,
    spend: 200,
    impressions: 10000,
    reach: 8000,
    clicks: 300,
    link_clicks: 250,
    form_leads: 10,
    messaging_started: 0,
    sales: 0,
    revenue: 0,
    campaign_id: "cmp_1",
    ...over,
  };
}

function campanha(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    company_id: "c1",
    empresa: "JCR2",
    account_id: "act_1",
    account_name: "Conta",
    campaign_id: "cmp_1",
    campanha: "Campanha",
    objective: null,
    tipo: "leadgen",
    status: "ACTIVE",
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    messaging_started: 0,
    form_leads: 0,
    sales: 0,
    revenue: 0,
    base_de_resultado: "formularios",
    rotulo_do_custo: "por formulario enviado",
    unidade_do_resultado: "formularios",
    resultados: 0,
    custo_por_resultado: null,
    cpc_link: null,
    last_synced_at: null,
    ...over,
  };
}

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2" };
  busca = {};
  anuncios = [];
  campanhas = [];
  carregando = false;
  modoRecebido = "";
  tiposRecebidos = [];
});

describe("sem empresa", () => {
  it("mostra o vazio", () => {
    empresa = null;
    render(<Anuncios />);
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });
});

describe("modo acumulado", () => {
  it("monta a barra de filtros como ACUMULADA", () => {
    // É o que faz o aviso "totais desde o início da conta" aparecer. Passar
    // "series" aqui deixaria o gestor achar que o período filtrou.
    render(<Anuncios />);
    expect(modoRecebido).toBe("accumulated");
  });

  it("oferece só os tipos presentes nas campanhas", () => {
    campanhas = [campanha({ tipo: "leadgen" }), campanha({ campaign_id: "c2", tipo: "mensagem" })];
    render(<Anuncios />);
    // Ordem CANONICA (TIPO_ORDER), nao alfabetica: mensagem vem antes de leadgen.
    // E a mesma ordem dos chips em toda tela, para o gestor nao ter de reprocurar.
    expect(tiposRecebidos).toEqual(["mensagem", "leadgen"]);
  });
});

describe("lista", () => {
  it("vazio explica que não há criativo com entrega", () => {
    anuncios = [];
    render(<Anuncios />);
    expect(screen.getByText("Nenhum anúncio para esta empresa")).toBeInTheDocument();
  });

  it("conta os anúncios exibidos no subtítulo", () => {
    anuncios = [anuncio({ id: "a" }), anuncio({ id: "b" })];
    render(<Anuncios />);
    expect(screen.getByText(/2 anúncio\(s\)/)).toBeInTheDocument();
  });

  it("carregando mostra esqueleto, não o vazio", () => {
    // "Nenhum anúncio" durante a carga faz o gestor achar que a conta está vazia.
    carregando = true;
    const { container } = render(<Anuncios />);
    expect(screen.queryByText("Nenhum anúncio para esta empresa")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("cartão do criativo", () => {
  it("mostra nome, status em pt-BR e os resultados SEPARADOS por base", () => {
    // O cartao nao tem mais "Leads"/"CPL": o anuncio nao produz "lead" generico, e a coluna
    // que somava formulario com conversa parou de ser atualizada em julho de 2026.
    anuncios = [anuncio({ name: "Vídeo Julho", spend: 200, form_leads: 10, messaging_started: 4 })];
    render(<Anuncios />);
    expect(screen.getByText("Vídeo Julho")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText(`R$${NB}200,00`)).toBeInTheDocument();
    expect(screen.getByText("Formulários")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Conversas")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("ZERO impressões não divide por zero no CTR", () => {
    anuncios = [anuncio({ impressions: 0, form_leads: 0 })];
    render(<Anuncios />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("calcula o CTR sobre impressões", () => {
    anuncios = [anuncio({ clicks: 300, impressions: 10000 })];
    render(<Anuncios />);
    expect(screen.getByText("3.00%")).toBeInTheDocument();
  });

  it("sem imagem mostra o marcador, sem quebrar o cartão", () => {
    anuncios = [anuncio({ thumbnail_url: null, image_url: null })];
    const { container } = render(<Anuncios />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("usa a miniatura quando existe, com alt do nome", () => {
    anuncios = [anuncio({ thumbnail_url: "https://x/thumb.jpg", name: "Criativo A" })];
    const { container } = render(<Anuncios />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x/thumb.jpg");
    expect(img.getAttribute("alt")).toBe("Criativo A");
  });

  it("link do post abre em nova aba com rel=noreferrer", () => {
    anuncios = [anuncio({ permalink_url: "https://facebook.com/post/1" })];
    render(<Anuncios />);
    const a = screen.getByRole("link", { name: /Ver post/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });

  it("sem permalink não mostra link morto", () => {
    anuncios = [anuncio({ permalink_url: null })];
    render(<Anuncios />);
    expect(screen.queryByRole("link", { name: /Ver post/ })).not.toBeInTheDocument();
  });
});

describe("filtros", () => {
  it("status filtra pelas variantes de pausa da Meta", () => {
    anuncios = [
      anuncio({ id: "a", status: "ACTIVE", name: "Criativo em veiculacao" }),
      anuncio({ id: "b", status: "ADSET_PAUSED", name: "Pausado pelo conjunto" }),
    ];
    busca = { status: "active" };
    render(<Anuncios />);
    expect(screen.getByText("Criativo em veiculacao")).toBeInTheDocument();
    expect(screen.queryByText("Pausado pelo conjunto")).not.toBeInTheDocument();
  });

  it("o TIPO vem da campanha-mãe — o anúncio não carrega categoria", () => {
    // Sem a junção por campaign_id o filtro de tipo não teria como funcionar.
    campanhas = [
      campanha({ campaign_id: "cmp_1", tipo: "leadgen" }),
      campanha({ campaign_id: "cmp_2", tipo: "mensagem" }),
    ];
    anuncios = [
      anuncio({ id: "a", campaign_id: "cmp_1", name: "De leadgen" }),
      anuncio({ id: "b", campaign_id: "cmp_2", name: "De mensagem" }),
    ];
    busca = { tipo: "leadgen" };
    render(<Anuncios />);
    expect(screen.getByText("De leadgen")).toBeInTheDocument();
    expect(screen.queryByText("De mensagem")).not.toBeInTheDocument();
  });

  it("anúncio ÓRFÃO (campanha ausente) some ao filtrar por tipo", () => {
    // Consequência honesta da junção: sem campanha não há tipo, então ele não
    // pertence a nenhum recorte de tipo.
    campanhas = [campanha({ campaign_id: "cmp_1", tipo: "leadgen" })];
    anuncios = [anuncio({ id: "orfao", campaign_id: null, name: "Sem campanha" })];
    busca = { tipo: "leadgen" };
    render(<Anuncios />);
    expect(screen.queryByText("Sem campanha")).not.toBeInTheDocument();
  });

  it("sem filtro de tipo, o órfão aparece", () => {
    anuncios = [anuncio({ id: "orfao", campaign_id: null, name: "Sem campanha" })];
    busca = {};
    render(<Anuncios />);
    expect(screen.getByText("Sem campanha")).toBeInTheDocument();
  });
});

describe("configuração da rota", () => {
  it("valida os query params dos filtros", () => {
    const validar = (Route.options as unknown as { validateSearch: (s: unknown) => unknown })
      .validateSearch;
    expect(validar({ preset: "7d", lixo: 1 })).toEqual({ preset: "7d" });
  });

  it("título da página", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Anúncios e criativos");
  });
});
