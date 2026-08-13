import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypeBadge } from "./type-badge";
import { TypeFilter, ALL_TYPES } from "./type-filter";
import { MetricCard, EmptyCompany } from "./metric-card";
import { Markdown } from "./markdown";
import { TIPO_META, type TipoConta } from "@/lib/breakdown";

// Os quatro primitivos de exibicao. Um arquivo so porque cada um e pequeno e
// nenhum tem estado proprio - o valor aqui e prender o comportamento diante de
// entrada inesperada, que e por onde eles quebrariam a tela toda.

describe("TypeBadge", () => {
  it("traduz o tipo conhecido", () => {
    render(<TypeBadge tipo="leadgen" />);
    expect(screen.getByText("Leadgen")).toBeInTheDocument();
  });

  it("tipo DESCONHECIDO cai em 'Outro' em vez de quebrar a tela", () => {
    // O tipo vem do banco; um valor novo nao pode derrubar a tabela inteira.
    render(<TypeBadge tipo="categoria_nova_do_backend" />);
    expect(screen.getByText("Outro")).toBeInTheDocument();
  });

  it("aplica as classes de cor do tipo", () => {
    render(<TypeBadge tipo="mensagem" />);
    expect(screen.getByText("Mensagem").className).toContain("emerald");
  });

  it("aceita className extra sem perder as proprias", () => {
    render(<TypeBadge tipo="vendas" className="ml-2" />);
    const el = screen.getByText("Vendas");
    expect(el.className).toContain("ml-2");
    expect(el.className).toContain("amber");
  });
});

describe("TypeFilter", () => {
  it("sem tipos nos dados, NAO renderiza nada", () => {
    // Filtro vazio ocuparia espaco oferecendo nenhuma escolha.
    const { container } = render(<TypeFilter types={[]} value={ALL_TYPES} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("oferece 'Todos' mais um chip por tipo presente", () => {
    render(<TypeFilter types={["leadgen", "mensagem"]} value={ALL_TYPES} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Todos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leadgen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mensagem" })).toBeInTheDocument();
  });

  it("informa a escolha ao consumidor", async () => {
    const onChange = vi.fn();
    render(<TypeFilter types={["leadgen"]} value={ALL_TYPES} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Leadgen" }));
    expect(onChange).toHaveBeenCalledWith("leadgen");
  });

  it("clicar em Todos limpa o filtro", async () => {
    const onChange = vi.fn();
    render(<TypeFilter types={["leadgen"]} value="leadgen" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(onChange).toHaveBeenCalledWith(ALL_TYPES);
  });

  it("o chip ATIVO se distingue visualmente dos inativos", async () => {
    render(<TypeFilter types={["leadgen", "vendas"]} value="leadgen" onChange={vi.fn()} />);
    const ativo = screen.getByRole("button", { name: "Leadgen" });
    const inativo = screen.getByRole("button", { name: "Vendas" });
    expect(ativo.className).not.toBe(inativo.className);
    expect(inativo.className).toContain("text-muted-foreground");
  });

  it("tipo sem entrada em TIPO_META aparece cru, sem estourar", () => {
    render(<TypeFilter types={["inventado" as TipoConta]} value={ALL_TYPES} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "inventado" })).toBeInTheDocument();
  });

  it("todo tipo canonico tem rotulo proprio (nao cai no cru)", () => {
    const tipos = Object.keys(TIPO_META) as TipoConta[];
    render(<TypeFilter types={tipos} value={ALL_TYPES} onChange={vi.fn()} />);
    for (const t of tipos) {
      expect(screen.getByRole("button", { name: TIPO_META[t].label })).toBeInTheDocument();
    }
  });
});

describe("MetricCard", () => {
  it("mostra rotulo e valor", () => {
    render(<MetricCard label="Investimento" value="R$ 1.234,00" />);
    expect(screen.getByText("Investimento")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.234,00")).toBeInTheDocument();
  });

  it("usa tabular-nums — numero em coluna tem de alinhar", () => {
    // Sem isso, cartoes lado a lado ficam com digitos desalinhados.
    render(<MetricCard label="Leads" value="1.234" />);
    expect(screen.getByText("1.234").className).toContain("tabular-nums");
  });

  it("mostra a dica quando informada", () => {
    render(<MetricCard label="CPL" value="R$ 20,00" hint="teto R$ 25,00" />);
    expect(screen.getByText("teto R$ 25,00")).toBeInTheDocument();
  });

  it("sem dica nao gera linha vazia", () => {
    const { container } = render(<MetricCard label="CPL" value="—" />);
    expect(container.textContent).toBe("CPL—");
  });

  it.each([
    ["success", "--color-success"],
    ["warning", "--color-warning"],
    ["destructive", "text-destructive"],
  ])("tom %s pinta o icone", (tone, esperado) => {
    const Icone = (props: { className?: string }) => (
      <svg data-testid="icone" className={props.className} />
    );
    render(
      <MetricCard
        label="x"
        value="1"
        tone={tone as "success" | "warning" | "destructive"}
        icon={Icone as never}
      />,
    );
    expect(screen.getByTestId("icone").getAttribute("class")).toContain(esperado);
  });

  it("sem icone nao renderiza svg", () => {
    const { container } = render(<MetricCard label="x" value="1" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("EmptyCompany", () => {
  it("diz o que fazer, nao apenas que esta vazio", () => {
    // Vazio sem instrucao deixa o usuario travado na primeira visita.
    render(<EmptyCompany />);
    expect(screen.getByText("Selecione ou cadastre uma empresa")).toBeInTheDocument();
    expect(screen.getByText(/Empresas e contas/)).toBeInTheDocument();
  });
});

describe("Markdown", () => {
  it("renderiza enfase e negrito como elementos, nao como asteriscos", () => {
    render(<Markdown>{"texto **forte** e *enfase*"}</Markdown>);
    expect(screen.getByText("forte").tagName).toBe("STRONG");
    expect(screen.getByText("enfase").tagName).toBe("EM");
  });

  it("renderiza titulos", () => {
    render(<Markdown>{"# Titulo\n\n## Subtitulo"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "Titulo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Subtitulo" })).toBeInTheDocument();
  });

  it("renderiza lista", () => {
    render(<Markdown>{"- um\n- dois"}</Markdown>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("TABELA do GFM funciona (precisa do remark-gfm)", () => {
    // Sem o plugin, a tabela sairia como texto cru com pipes - e o agente manda
    // tabela no chat.
    render(<Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
  });

  it("link abre em nova aba com rel=noreferrer", () => {
    // O conteudo vem do modelo: abrir na mesma aba tiraria o gestor da operacao,
    // e sem noreferrer a pagina destino saberia de onde veio.
    render(<Markdown>{"[site](https://exemplo.com)"}</Markdown>);
    const a = screen.getByRole("link", { name: "site" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });

  it("bloco de codigo vira pre com rolagem propria", () => {
    // Sem overflow proprio, uma linha longa empurraria a largura do chat inteiro.
    const { container } = render(<Markdown>{"```\nlinha de codigo\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("overflow-x-auto");
  });

  it("string vazia nao estoura", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container).toBeTruthy();
  });

  it("aceita className do consumidor", () => {
    const { container } = render(<Markdown className="mt-4">texto</Markdown>);
    expect(container.firstElementChild?.className).toContain("mt-4");
  });
});
