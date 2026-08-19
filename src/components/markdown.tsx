import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Renderer de markdown do projeto. Estiliza os elementos com Tailwind (não há
// plugin de typography). remark-gfm habilita tabelas, listas de tarefas etc.
const components: Components = {
  p: ({ node: _n, children, ...p }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...p}>
      {children}
    </p>
  ),
  h1: ({ node: _n, children, ...p }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0" {...p}>
      {children}
    </h1>
  ),
  h2: ({ node: _n, children, ...p }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...p}>
      {children}
    </h2>
  ),
  h3: ({ node: _n, children, ...p }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...p}>
      {children}
    </h3>
  ),
  h4: ({ node: _n, children, ...p }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0" {...p}>
      {children}
    </h4>
  ),
  ul: ({ node: _n, children, ...p }) => (
    <ul className="my-2 ml-5 list-disc space-y-1" {...p}>
      {children}
    </ul>
  ),
  ol: ({ node: _n, children, ...p }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1" {...p}>
      {children}
    </ol>
  ),
  li: ({ node: _n, children, ...p }) => (
    <li className="leading-relaxed" {...p}>
      {children}
    </li>
  ),
  strong: ({ node: _n, children, ...p }) => (
    <strong className="font-semibold" {...p}>
      {children}
    </strong>
  ),
  em: ({ node: _n, children, ...p }) => (
    <em className="italic" {...p}>
      {children}
    </em>
  ),
  a: ({ node: _n, children, ...p }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...p}
    >
      {children}
    </a>
  ),
  blockquote: ({ node: _n, children, ...p }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground" {...p}>
      {children}
    </blockquote>
  ),
  hr: ({ node: _n, ...p }) => <hr className="my-3 border-border" {...p} />,
  code: ({ node: _n, className, children, ...p }) => (
    <code
      className={cn(
        "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0",
        className,
      )}
      {...p}
    >
      {children}
    </code>
  ),
  pre: ({ node: _n, children, ...p }) => (
    <pre className="my-2 max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs" {...p}>
      {children}
    </pre>
  ),
  table: ({ node: _n, children, ...p }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table className="w-full min-w-0 border-collapse text-sm" {...p}>
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _n, children, ...p }) => (
    <thead className="border-b border-border" {...p}>
      {children}
    </thead>
  ),
  th: ({ node: _n, children, ...p }) => (
    <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap" {...p}>
      {children}
    </th>
  ),
  td: ({ node: _n, children, ...p }) => (
    <td className="max-w-[18rem] border-b border-border/50 px-2 py-1.5 break-words" {...p}>
      {children}
    </td>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn("max-w-full min-w-0 break-words text-sm [overflow-wrap:anywhere]", className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
