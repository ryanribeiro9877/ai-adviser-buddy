import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// URL assinada da sessão. O bucket é privado: o caminho sozinho não abre o arquivo.
export function useMiniaturasAssinadas(caminhos: string[]) {
  const chave = caminhos.slice().sort().join("\n");
  return useQuery({
    queryKey: ["criativos-assinados", chave],
    enabled: caminhos.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from("criativos").createSignedUrls(caminhos, 60 * 50);
      if (error) throw error;
      const mapa: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl && !item.error) mapa[item.path] = item.signedUrl;
      }
      return mapa;
    },
  });
}

// meta_video_id do criativo → arquivo que o time produziu. Sem junção, sem botão.
export function useDrivePorVideo(companyId: string | null) {
  return useQuery({
    queryKey: ["drive-por-video", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("media_uploads")
        .select("meta_video_id,drive_file_id,status,enviado_em")
        .eq("company_id", companyId!)
        .not("drive_file_id", "is", null)
        .not("meta_video_id", "is", null);
      if (error) throw error;
      const mapa = new Map<string, string>();
      const nota = new Map<string, string>();
      for (const row of data ?? []) {
        const video = row.meta_video_id;
        const drive = row.drive_file_id;
        if (!video || !drive) continue;
        const score = `${row.status === "enviado" ? "1" : "0"}|${row.enviado_em ?? ""}`;
        const anterior = nota.get(video);
        if (anterior && anterior >= score) continue;
        nota.set(video, score);
        mapa.set(video, drive);
      }
      return mapa;
    },
  });
}
