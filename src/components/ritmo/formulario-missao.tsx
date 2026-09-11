import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
}) {
  const set = (patch: Partial<FormMissaoRitmo>) => onChange({ ...form, ...patch });
  const ativas = useMemo(
    () => campanhas.filter((c) => campanhaEstaAtiva(c.status)),
    [campanhas],
  );
  const sufixoSonho = unidadeSonho(form.metrica) === "pct" ? "%" : "unid.";

  const enviar = () => {
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
        </div>
        {avisoFonte && <p className="text-xs text-muted-foreground">{avisoFonte}</p>}
        <select
          id="ritmo-campanha"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!isAdmin}
          value={form.campaignId}
          onChange={(e) => {
            const id = e.target.value;
            const c = ativas.find((x) => x.external_id === id);
            set({
              campaignId: id,
              campaignName: c?.nome ?? "",
              adAccountId: "",
            });
          }}
        >
          <option value="">Escolha uma campanha ativa</option>
          {ativas.map((c) => (
            <option key={c.external_id} value={c.external_id}>
              {c.nome}
            </option>
          ))}
        </select>
        {ativas.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma campanha ativa nesta empresa.</p>
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
          <select
            id="ritmo-metrica"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isAdmin}
            value={form.metrica}
            onChange={(e) => set({ metrica: e.target.value })}
          >
            {METRICAS_RITMO.map((m) => (
              <option key={m} value={m}>
                {rotuloMetrica(m)}
              </option>
            ))}
          </select>
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
            type="number"
            min={0}
            step="0.01"
            disabled={!isAdmin}
            value={form.extra}
            onChange={(e) => set({ extra: e.target.value })}
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
        <Button type="button" onClick={enviar}>
          Criar força-tarefa
        </Button>
      )}
    </div>
  );
}
