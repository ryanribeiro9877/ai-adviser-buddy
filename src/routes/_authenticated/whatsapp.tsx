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
          Saúde dos números Cloud API e inventário Click-to-WhatsApp de {selectedCompany.name}.
          Somente leitura — Cloud API vem do sync diário; números em anúncios vêm dos destinos
          wa.me.
        </p>
      </div>

      <WhatsAppPanel companyId={selectedCompany.id} />

      <div className="border-t border-border pt-6">
        <InfobipPanel companyId={selectedCompany.id} />
      </div>
    </div>
  );
}
