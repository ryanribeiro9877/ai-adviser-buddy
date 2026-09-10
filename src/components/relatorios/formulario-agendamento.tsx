import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SECOES_RELATORIO,
  campanhaEstaAtiva,
  presetDiarioOperacional,
  rotuloStatusCampanha,
  type CampanhaRelatorio,
  type ChaveSecaoRelatorio,
  type FrequenciaRelatorio,
  type JanelaAnalise,
  type RecorteCampanhas,
} from "@/lib/relatorios";

export type FormAgendamento = {
  nome: string;
  frequencia: FrequenciaRelatorio;
  horaLocal: string;
  diaSemana: number;
  intervaloHoras: number;
  recorte: RecorteCampanhas;
  campaignIds: string[];
  janela: JanelaAnalise;
  secoes: ChaveSecaoRelatorio[];
};

export function formVazio(): FormAgendamento {
  const p = presetDiarioOperacional();
  return {
    nome: p.nome,
    frequencia: p.frequencia,
    horaLocal: p.horaLocal,
    diaSemana: 1,
    intervaloHoras: 6,
    recorte: p.recorte,
    campaignIds: [],
    janela: p.janela,
    secoes: p.secoes,
  };
}

export function FormularioAgendamento({
  form,
  onChange,
  campanhas,
  fonteCampanhas,
  avisoFonte,
  carregandoCampanhas,
  onRecarregarCampanhas,
  isAdmin,
}: {
  form: FormAgendamento;
  onChange: (next: FormAgendamento) => void;
  campanhas: CampanhaRelatorio[];
  fonteCampanhas: "ao_vivo" | "espelho";
  avisoFonte: string | null;
  carregandoCampanhas: boolean;
  onRecarregarCampanhas: () => void;
  isAdmin: boolean;
}) {
  const set = (patch: Partial<FormAgendamento>) => onChange({ ...form, ...patch });
  const ativas = useMemo(() => campanhas.filter((c) => campanhaEstaAtiva(c.status)), [campanhas]);

  const toggleSecao = (chave: ChaveSecaoRelatorio, ligada: boolean) => {
    if (ligada) {
      if (form.secoes.includes(chave)) return;
      set({ secoes: [...form.secoes, chave] });
      return;
    }
    set({ secoes: form.secoes.filter((s) => s !== chave) });
  };

  const toggleCampanha = (id: string, ligada: boolean) => {
    if (ligada) {
      if (form.campaignIds.includes(id)) return;
      set({ campaignIds: [...form.campaignIds, id] });
      return;
    }
    set({ campaignIds: form.campaignIds.filter((x) => x !== id) });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rel-nome">Nome</Label>
          <Input
            id="rel-nome"
            value={form.nome}
            disabled={!isAdmin}
            onChange={(e) => set({ nome: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Janela de análise</Label>
          <Select
            value={form.janela}
            disabled={!isAdmin}
            onValueChange={(v) => set({ janela: v as JanelaAnalise })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ontem">Ontem (dia fechado)</SelectItem>
              <SelectItem value="3d">Últimos 3 dias fechados</SelectItem>
              <SelectItem value="7d">Últimos 7 dias fechados</SelectItem>
              <SelectItem value="14d">Últimos 14 dias fechados</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Quando rodar</Label>
          <Select
            value={form.frequencia}
            disabled={!isAdmin}
            onValueChange={(v) => set({ frequencia: v as FrequenciaRelatorio })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="diaria">Todo dia</SelectItem>
              <SelectItem value="dias_uteis">Dias úteis</SelectItem>
              <SelectItem value="semanal">Uma vez por semana</SelectItem>
              <SelectItem value="cada_n_horas">A cada N horas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.frequencia === "cada_n_horas" ? (
          <div className="space-y-2">
            <Label htmlFor="rel-nhoras">Intervalo (horas)</Label>
            <Input
              id="rel-nhoras"
              type="number"
              min={1}
              max={72}
              disabled={!isAdmin}
              value={form.intervaloHoras}
              onChange={(e) => set({ intervaloHoras: Number(e.target.value) || 1 })}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="rel-hora">Horário (Brasília)</Label>
            <Input
              id="rel-hora"
              type="time"
              disabled={!isAdmin}
              value={form.horaLocal}
              onChange={(e) => set({ horaLocal: e.target.value || "08:00" })}
            />
          </div>
        )}
        {form.frequencia === "semanal" && (
          <div className="space-y-2">
            <Label>Dia da semana</Label>
            <Select
              value={String(form.diaSemana)}
              disabled={!isAdmin}
              onValueChange={(v) => set({ diaSemana: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Segunda</SelectItem>
                <SelectItem value="2">Terça</SelectItem>
                <SelectItem value="3">Quarta</SelectItem>
                <SelectItem value="4">Quinta</SelectItem>
                <SelectItem value="5">Sexta</SelectItem>
                <SelectItem value="6">Sábado</SelectItem>
                <SelectItem value="0">Domingo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Campanhas</Label>
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
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="recorte"
              disabled={!isAdmin}
              checked={form.recorte === "todas_ativas"}
              onChange={() => set({ recorte: "todas_ativas" })}
            />
            Todas as ativas (dinâmico) — {ativas.length} agora
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="recorte"
              disabled={!isAdmin}
              checked={form.recorte === "ids_fixos"}
              onChange={() => set({ recorte: "ids_fixos" })}
            />
            Escolher campanhas
          </label>
        </div>
        {form.recorte === "ids_fixos" && (
          <div className="max-h-56 overflow-auto rounded-md border border-border">
            {campanhas.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">Nenhuma campanha nesta empresa.</p>
            ) : (
              campanhas.map((c) => (
                <label
                  key={c.external_id}
                  className="flex items-start gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!isAdmin}
                    checked={form.campaignIds.includes(c.external_id)}
                    onChange={(e) => toggleCampanha(c.external_id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{c.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {rotuloStatusCampanha(c.status)}
                      {c.fonte === "espelho" ? " · só no espelho" : ""}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>O que deve conter</Label>
          {isAdmin && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set({ secoes: SECOES_RELATORIO.map((s) => s.chave) })}
            >
              Marcar tudo
            </Button>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {SECOES_RELATORIO.map((s) => (
            <label
              key={s.chave}
              className="flex items-start gap-3 rounded-md border border-border px-3 py-2"
            >
              <Switch
                checked={form.secoes.includes(s.chave)}
                disabled={!isAdmin}
                onCheckedChange={(v) => toggleSecao(s.chave, v)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium">{s.titulo}</span>
                <span className="block text-xs text-muted-foreground">{s.descricao}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
