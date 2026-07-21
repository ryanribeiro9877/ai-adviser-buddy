import { Wallet, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TypeBadge } from "@/components/type-badge";
import { fmtBRL, type AccountRow } from "@/lib/breakdown";

export const ALL_ACCOUNTS = "all";

export function AccountSelector({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountRow[];
  value: string; // account_id ou ALL_ACCOUNTS
  onChange: (v: string) => void;
}) {
  const active = accounts.filter((a) => a.tipo_conta !== "sem_dados");
  const dormant = accounts.filter((a) => a.tipo_conta === "sem_dados");
  const selected = accounts.find((a) => a.account_id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[260px]">
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {value === ALL_ACCOUNTS ? "Todas as contas" : (selected?.account_name ?? "Conta")}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuItem onClick={() => onChange(ALL_ACCOUNTS)} className="gap-2">
          <span className="font-medium">Todas as contas</span>
          {value === ALL_ACCOUNTS && <Check className="h-4 w-4 ml-auto text-primary" />}
        </DropdownMenuItem>

        {active.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Com dados
            </DropdownMenuLabel>
            {active.map((a) => (
              <DropdownMenuItem
                key={a.account_id}
                onClick={() => onChange(a.account_id)}
                className="gap-2"
              >
                <span className="truncate">{a.account_name}</span>
                <TypeBadge tipo={a.tipo_conta} className="ml-1" />
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {fmtBRL(a.spend)}
                </span>
                {value === a.account_id && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {dormant.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Sem dados no período ({dormant.length})
            </DropdownMenuLabel>
            {dormant.map((a) => (
              <DropdownMenuItem key={a.account_id} disabled className="opacity-50">
                <span className="truncate">{a.account_name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
