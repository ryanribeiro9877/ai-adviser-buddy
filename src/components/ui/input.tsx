import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // O campo tem fundo proprio (--secondary, L .28) em vez de bg-transparent:
          // antes ele herdava a cor do card (L .21) com borda L .24 e parecia invisivel.
          // .28 e a mesma cor da aba inativa, que ja se distingue bem do card, e tambem
          // funciona sobre o fundo da pagina (L .16).
          "flex h-9 w-full rounded-md border border-border bg-secondary px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-ring/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
