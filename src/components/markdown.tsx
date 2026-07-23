import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Renderer de markdown do projeto. Estiliza os elementos com Tailwind (não há
// plugin de typography). remark-gfm habilita tabelas, listas de tarefas etc.
const components: Components = {
  p: ({ node: _n, ...p }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  h1: ({ node: _n, ...p }) => <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...p} />,
  h2: ({ node: _n, ...p }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...p} />
  ),
  h3: ({ node: _n, ...p }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...p} />
  ),
  h4: ({ node: _n, ...p }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...p} />
  ),
  ul: ({ node: _n, ...p }) => <ul className="my-2 ml-5 list-disc space-y-1" {...p} />,
  ol: ({ node: _n, ...p }) => <ol className="my-2 ml-5 list-decimal space-y-1" {...p} />,
  li: ({ node: _n, ...p }) => <li className="leading-relaxed" {...p} />,
  strong: ({ node: _n, ...p }) => <strong className="font-semibold" {...p} />,
  em: ({ node: _n, ...p }) => <em className="italic" {...p} />,
  a: ({ node: _n, ...p }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground" {...p} />
  ),
  hr: ({ node: _n, ...p }) => <hr className="my-3 border-border" {...p} />,
  code: ({ node: _n, className, ...p }) => (
    <code
      className={cn(
        "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0",
        className,
      )}
      {...p}
    />
  ),
  pre: ({ node: _n, ...p }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs" {...p} />
  ),
  table: ({ node: _n, ...p }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: ({ node: _n, ...p }) => <thead className="border-b border-border" {...p} />,
  th: ({ node: _n, ...p }) => <th className="px-2 py-1.5 text-left font-semibold" {...p} />,
  td: ({ node: _n, ...p }) => <td className="border-b border-border/50 px-2 py-1.5" {...p} />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
