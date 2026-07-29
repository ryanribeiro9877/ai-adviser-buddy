import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { WhatsAppPanel } from "@/components/whatsapp-panel";
import { InfobipPanel } from "@/components/infobip-panel";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  component: WhatsAppPage,
  head: () => ({ meta: [{ title: "WhatsApp" }] }),
});

function WhatsAppPage() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <MessageCircle className="h-6 w-6 text-primary" />
          WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">
          Saúde dos números e desempenho dos templates de {selectedCompany.name}. Somente leitura —
          os dados vêm do sync diário da API oficial.
        </p>
      </div>

      <WhatsAppPanel companyId={selectedCompany.id} />

      <div className="border-t border-border pt-6">
        <InfobipPanel companyId={selectedCompany.id} />
      </div>
    </div>
  );
}
