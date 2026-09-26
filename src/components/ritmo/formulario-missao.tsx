import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtBRL } from "@/lib/breakdown";
import {
  METRICAS_RITMO,
  rotuloMetrica,
  unidadeSonho,
  validarPedidoMissao,
} from "@/lib/ritmo";
import {
  campanhaEstaAtiva,
  hojeYmdBrasilia,
  type CampanhaRelatorio,
} from "@/lib/relatorios";

/** Lista aberta: preto no branco. Hover cinza claro. Gatilho fechado segue o diálogo. */
const CLASSE_LISTA_SELETOR = "z-[300] bg-white text-black";
const CLASSE_ITEM_SELETOR =
  "cursor-pointer bg-white text-black hover:bg-neutral-200 hover:text-black focus:bg-neutral-200 focus:text-black data-[highlighted]:bg-neutral-200 data-[highlighted]:text-black data-[state=checked]:text-black";
const ESTILO_ITEM_SELETOR = { color: "#000" } as const;

/**
 * Digitos do campo → reais canônicos ("50000000", "50.5") para Number()/RPC.
 * Ponto de milhar é ignorado; vírgula é decimal.
 */
export function parseExtraInvestimento(bruto: string): string {
  const t = bruto.trim();
  if (t === "") return "";
  const negativo = t.startsWith("-");
  const so = bruto.replace(/[^\d,]/g, "");
  if (so === "" || so === ",") return "";
  const virgula = so.indexOf(",");
  const temCentavos = virgula !== -1;
  const inteiros = (temCentavos ? so.slice(0, virgula) : so).replace(/\D/g, "");
  const centavos = temCentavos ? so.slice(virgula + 1).replace(/\D/g, "").slice(0, 2) : "";
  const intNorm = inteiros.replace(/^0+(?=\d)/, "");
  if (!temCentavos) {
    if (intNorm === "") return "";
    return `${negativo ? "-" : ""}${intNorm}`;
  }
  const intOuZero = intNorm === "" ? "0" : intNorm;
  const corpo = centavos === "" ? `${intOuZero}.` : `${intOuZero}.${centavos}`;
  return `${negativo ? "-" : ""}${corpo}`;
}

/** Mostra pt-BR (R$ 5.000.000); centavos só quando existem. Nunca devolve só dígitos. */
export function formatarExtraInvestimento(extra: string): string {
  const t = extra.trim();
  if (t === "") return "";
  const incompleto = t.endsWith(".");
  const n = Number(incompleto ? t.slice(0, -1) || "0" : t);
  if (!Number.isFinite(n)) {
    const canon = parseExtraInvestimento(extra);
    if (canon !== "" && canon !== extra) return formatarExtraInvestimento(canon);
    return extra;
  }
  if (incompleto || Number.isInteger(n)) {
    const texto = n.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return incompleto ? `${texto},` : texto;
  }
  return fmtBRL(n);
}

export type FormMissaoRitmo = {
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  periodoInicio: string;
  periodoFim: string;
  metrica: string;
  dissertacao: string;
  sonho: string;
  extra: string;
};

const MOTIVO_TOAST: Record<string, string> = {
  campanha_obrigatoria: "Escolha uma campanha ativa.",
  dissertacao_obrigatoria: "Descreva o que a força-tarefa deve fazer.",
  metrica_desconhecida: "Escolha uma métrica válida.",
  prazo_invalido: "O prazo precisa ter entre 1 e 90 dias.",
  sonho_invalido: "O sonho, se informado, precisa ser maior que zero.",
  extra_invalido: "O extra de investimento não pode ser negativo.",
};

export function formVazioMissao(): FormMissaoRitmo {
  const hoje = hojeYmdBrasilia(new Date());
  return {
    campaignId: "",
    campaignName: "",
    adAccountId: "",
    periodoInicio: hoje,
    periodoFim: hoje,
    metrica: METRICAS_RITMO[0],
    dissertacao: "",
    sonho: "",
    extra: "",
  };
}

export function FormularioMissao({
  form,
  onChange,
  campanhas,
  fonteCampanhas,
  avisoFonte,
  carregandoCampanhas,
  onRecarregarCampanhas,
  isAdmin,
  onSubmit,
  ocupado = false,
  campanhaTravada = false,
  rotuloBotao = "Criar força-tarefa",
}: {
  form: FormMissaoRitmo;
  onChange: (next: FormMissaoRitmo) => void;
  campanhas: CampanhaRelatorio[];
  fonteCampanhas: "ao_vivo" | "espelho";
  avisoFonte: string | null;
  carregandoCampanhas: boolean;
  onRecarregarCampanhas: () => void;
  isAdmin: boolean;
  onSubmit?: (form: FormMissaoRitmo) => void;
  ocupado?: boolean;
  /** Em execução a campanha já está concedida: o seletor some e o nome fica fixo. */
  campanhaTravada?: boolean;
  rotuloBotao?: string;
}) {
  const set = (patch: Partial<FormMissaoRitmo>) => onChange({ ...form, ...patch });
  const ativas = useMemo(
    () => campanhas.filter((c) => campanhaEstaAtiva(c.status)),
    [campanhas],
  );
  const sufixoSonho = unidadeSonho(form.metrica) === "pct" ? "%" : "unid.";

  const enviar = () => {
    if (ocupado) return;
    const extra = form.extra.trim() === "" ? undefined : form.extra;
    const sonho = form.sonho.trim() === "" ? undefined : form.sonho;
    const r = validarPedidoMissao({
      campaignId: form.campaignId,
      periodoInicio: form.periodoInicio,
      periodoFim: form.periodoFim,
      metrica: form.metrica,
      dissertacao: form.dissertacao,
      sonho,
      extra,
    });
    if (!r.ok) {
      toast.error(MOTIVO_TOAST[r.motivo ?? ""] ?? "Não foi possível validar o pedido.");
      return;
    }
    onSubmit?.(form);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="ritmo-campanha">Campanha</Label>
          {!campanhaTravada && (
            <div className="flex items-center gap-2">
              <Badge variant={fonteCampanhas === "ao_vivo" ? "default" : "outline"}>
                {fonteCampanhas === "ao_vivo" ? "lista ao vivo" : "espelho local"}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRecarregarCampanhas}
                disabled={carregandoCampanhas}
              >
                Atualizar lista
              </Button>
            </div>
          )}
        </div>
        {campanhaTravada ? (
          <p id="ritmo-campanha" className="text-sm font-medium">
            {form.campaignName || form.campaignId}
          </p>
        ) : (
          <>
            {avisoFonte && <p className="text-xs text-muted-foreground">{avisoFonte}</p>}
            <Select
              value={form.campaignId || undefined}
              disabled={!isAdmin}
              onValueChange={(id) => {
                const c = ativas.find((x) => x.external_id === id);
                set({
                  campaignId: id,
                  campaignName: c?.nome ?? "",
                  adAccountId: "",
                });
              }}
            >
              <SelectTrigger id="ritmo-campanha" className="w-full">
                <SelectValue placeholder="Escolha uma campanha ativa" />
              </SelectTrigger>
              <SelectContent position="item-aligned" className={CLASSE_LISTA_SELETOR}>
                {ativas.map((c) => (
                  <SelectItem
                    key={c.external_id}
                    value={c.external_id}
                    className={CLASSE_ITEM_SELETOR}
                    style={ESTILO_ITEM_SELETOR}
                  >
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ativas.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma campanha ativa nesta empresa.</p>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ritmo-inicio">Início</Label>
          <Input
            id="ritmo-inicio"
            type="date"
            disabled={!isAdmin}
            value={form.periodoInicio}
            onChange={(e) => set({ periodoInicio: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ritmo-fim">Fim</Label>
          <Input
            id="ritmo-fim"
            type="date"
            disabled={!isAdmin}
            value={form.periodoFim}
            onChange={(e) => set({ periodoFim: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ritmo-metrica">Métrica</Label>
          <Select
            value={form.metrica}
            disabled={!isAdmin}
            onValueChange={(v) => set({ metrica: v })}
          >
            <SelectTrigger id="ritmo-metrica" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="item-aligned" className={CLASSE_LISTA_SELETOR}>
              {METRICAS_RITMO.map((m) => (
                <SelectItem
                  key={m}
                  value={m}
                  className={CLASSE_ITEM_SELETOR}
                  style={ESTILO_ITEM_SELETOR}
                >
                  {rotuloMetrica(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ritmo-sonho">Sonho (opcional)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="ritmo-sonho"
              type="number"
              min={0}
              step="any"
              disabled={!isAdmin}
              value={form.sonho}
              onChange={(e) => set({ sonho: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">{sufixoSonho}</span>
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="ritmo-extra">Extra de investimento (R$, opcional)</Label>
          <Input
            id="ritmo-extra"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={!isAdmin}
            value={formatarExtraInvestimento(form.extra)}
            onChange={(e) => set({ extra: parseExtraInvestimento(e.target.value) })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ritmo-dissertacao">Dissertação</Label>
        <Textarea
          id="ritmo-dissertacao"
          disabled={!isAdmin}
          value={form.dissertacao}
          onChange={(e) => set({ dissertacao: e.target.value })}
          rows={4}
        />
      </div>

      {isAdmin && (
        <Button type="button" onClick={enviar} disabled={ocupado}>
          {rotuloBotao}
        </Button>
      )}
    </div>
  );
}
