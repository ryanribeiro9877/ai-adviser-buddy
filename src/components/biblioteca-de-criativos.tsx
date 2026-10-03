import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { FalhaDeCarga } from "@/components/falha-de-carga";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtBRL } from "@/lib/breakdown";
import {
  MAX_ATIVOS_POR_CARD,
  chaveDoAtivo,
  conferenciaDaLista,
  dataBr,
  podeMarcar,
  rotuloBloqueio,
  rotuloMotivo,
  type AtivoOrfao,
  type ListaDeAtivos,
} from "@/lib/ativos-orfaos";

async function buscarLista(companyId: string, dias: number): Promise<ListaDeAtivos> {
  const { data, error } = await supabase.functions.invoke("listar-ativos-orfaos", {
    body: { company_id: companyId, dias_sem_uso: dias },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(String(data?.erro ?? "A listagem não veio."));
  const ativos = Array.isArray(data.ativos) ? data.ativos.map(normalizar) : [];
  return { ...data, ativos };
}

function normalizar(row: AtivoOrfao): AtivoOrfao {
  const gasto = row.gasto_total == null ? null : Number(row.gasto_total);
  return {
    ...row,
    anuncios: Array.isArray(row.anuncios) ? row.anuncios : [],
    gasto_total: gasto != null && Number.isFinite(gasto) ? gasto : null,
    candidato: row.candidato === true,
  };
}

export function BibliotecaDeCriativosPainel() {
  const { selectedCompany } = useApp();
  const [dias, setDias] = useState(90);
  const companyId = selectedCompany?.id ?? null;
  const consulta = useQuery({
    queryKey: ["biblioteca-orfaos", companyId, dias],
    enabled: !!companyId,
    queryFn: () => buscarLista(companyId!, dias),
  });

  if (!companyId) return null;
  if (consulta.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (consulta.isError) {
    return (
      <FalhaDeCarga
        oQue="a biblioteca de criativos"
        erro={consulta.error}
        onTentarDeNovo={() => consulta.refetch()}
      />
    );
  }
  return (
    <BibliotecaDeCriativos
      lista={consulta.data!}
      dias={dias}
      onDias={setDias}
    />
  );
}

export function BibliotecaDeCriativos({
  lista,
  dias,
  onDias,
}: {
  lista: ListaDeAtivos;
  dias: number;
  onDias: (dias: number) => void;
}) {
  const [soCandidatos, setSoCandidatos] = useState(true);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const porId = useMemo(() => new Map(lista.ativos.map((a) => [a.id, a])), [lista.ativos]);
  const conferencia = useMemo(
    () => conferenciaDaLista(lista.ativos, lista.dias_sem_uso),
    [lista.ativos, lista.dias_sem_uso],
  );
  const visiveis = lista.ativos.filter((a) => (soCandidatos ? a.candidato : true));
  const candidatos = lista.ativos.filter((a) => a.candidato).length;

  function alternar(ativo: AtivoOrfao) {
    if (!ativo.candidato) return;
    const chave = chaveDoAtivo(ativo.tipo, ativo.id);
    setMarcados((atual) => {
      const ja = atual.has(chave);
      if (!podeMarcar(atual.size, ja)) return atual;
      const proximo = new Set(atual);
      if (ja) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-3xl">
        O que não está em anúncio ativo pode sair da biblioteca. Isso não apaga o gasto, a
        avaliação de política nem a reputação da conta — só tira o arquivo repetido do caminho.
        A exclusão ainda não está ligada: esta lista é para conferir o critério.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Dias sem uso</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={dias}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 3650) onDias(n);
            }}
            className="mt-1 h-9 w-24 rounded-md border bg-background px-2"
          />
        </label>
        <Button type="button" size="sm" variant={soCandidatos ? "default" : "outline"} onClick={() => setSoCandidatos(true)}>
          Candidatos · {candidatos}
        </Button>
        <Button type="button" size="sm" variant={!soCandidatos ? "default" : "outline"} onClick={() => setSoCandidatos(false)}>
          Todos · {lista.ativos.length}
        </Button>
      </div>

      <Card className="p-4 space-y-1 text-sm">
        <div>
          01. Setembro.mp4: {conferencia.setembro === 0 ? "não apareceu nesta leitura" : `${conferencia.setembro} arquivo(s)`}
          {conferencia.fica ? ` · fica ${conferencia.fica}` : ""}
        </div>
        <div>Candidatos ligados a anúncio do La Felicità: {conferencia.laFelicita}</div>
        <div>Candidatos com gasto desde {dataBr(conferencia.limite)}: {conferencia.comGasto}</div>
        {conferencia.comGasto > 0 && (
          <p className="text-destructive">Há candidato com gasto na janela. A exclusão não entra enquanto isso aparecer.</p>
        )}
        {conferencia.laFelicita > 0 && (
          <p className="text-destructive">Anúncio do La Felicità está entre os candidatos. A exclusão não entra.</p>
        )}
      </Card>

      {lista.miniaturas_faltando != null && lista.miniaturas_faltando > 0 && (
        <p className="text-sm text-muted-foreground">
          Faltam {lista.miniaturas_faltando} capas no nosso arquivo. Sem elas, a peça de agosto e setembro
          some da auditoria quando a exclusão existir.
        </p>
      )}
      {lista.faxina_adiada_ate && (
        <p className="text-sm">
          Campanha na primeira semana. A faxina não roda antes de {dataBr(lista.faxina_adiada_ate)}.
        </p>
      )}
      {lista.aprendizado_desconhecido && (
        <p className="text-sm text-muted-foreground">
          Não deu para ler a data das campanhas. A faxina não roda sem essa data.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        {marcados.size} de {MAX_ATIVOS_POR_CARD} selecionados para um card futuro.
        {lista.videos} vídeos e {lista.imagens} imagens lidos na conta {lista.account_id}.
      </p>

      {visiveis.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {candidatos === 0 ? "Nenhum candidato nesta leitura." : "Nada neste recorte."}
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Arquivo</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Anúncios</TableHead>
              <TableHead>Último gasto</TableHead>
              <TableHead>Gasto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((ativo) => {
              const chave = chaveDoAtivo(ativo.tipo, ativo.id);
              const marcado = marcados.has(chave);
              const fica = ativo.duplicata_de ? porId.get(ativo.duplicata_de) : undefined;
              const nomes = (ativo.anuncios ?? []).map((a) => a.nome || a.id).filter(Boolean);
              return (
                <TableRow key={chave} data-state={marcado ? "selected" : undefined}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${ativo.nome || ativo.id}`}
                      checked={marcado}
                      disabled={!ativo.candidato || !podeMarcar(marcados.size, marcado)}
                      onChange={() => alternar(ativo)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{ativo.nome || ativo.id}</div>
                    <div className="text-xs text-muted-foreground">
                      {ativo.tipo === "video" ? "Vídeo" : "Imagem"} · {ativo.id}
                    </div>
                    {ativo.duplicata_de && (
                      <div className="text-xs">
                        Fica {fica?.nome || ativo.duplicata_de}
                      </div>
                    )}
                    {ativo.bloqueado_por && (
                      <div className="text-xs text-muted-foreground">{rotuloBloqueio(ativo.bloqueado_por)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {ativo.motivo ? <Badge variant={ativo.motivo === "anuncio_inativo" ? "destructive" : "secondary"}>{rotuloMotivo(ativo.motivo)}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="max-w-[240px] text-xs">
                    {nomes.length === 0 ? "—" : nomes.slice(0, 3).join(", ")}
                    {nomes.length > 3 ? ` +${nomes.length - 3}` : ""}
                  </TableCell>
                  <TableCell>{dataBr(ativo.ultimo_gasto_em)}</TableCell>
                  <TableCell>{ativo.gasto_total == null ? "—" : fmtBRL(ativo.gasto_total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
