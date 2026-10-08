import { describe, it, expect } from "vitest";
import {
  capacidadeDoTier,
  chaveTelefone,
  isClickToWhatsApp,
  isWabaInventory,
  vistoNoUltimoSync,
} from "@/components/whatsapp-panel";

describe("isWabaInventory / isClickToWhatsApp", () => {
  it("trata CLOUD_API como inventário WABA", () => {
    expect(isWabaInventory({ platform_type: "CLOUD_API", external_id: "123" })).toBe(true);
  });

  it("trata ON_PREMISE e platform_type null (sync antigo) como WABA", () => {
    expect(isWabaInventory({ platform_type: "ON_PREMISE", external_id: "1" })).toBe(true);
    expect(isWabaInventory({ platform_type: null, external_id: "1075095699012418" })).toBe(true);
  });

  it("exclui Click-to-WhatsApp e ads-wa:", () => {
    expect(
      isWabaInventory({
        platform_type: "CLICK_TO_WHATSAPP",
        external_id: "ads-wa:cohapm:5571",
      }),
    ).toBe(false);
    expect(isClickToWhatsApp({ platform_type: null, external_id: "ads-wa:x:1" })).toBe(true);
  });

  it("exclui NOT_APPLICABLE do inventário vivo", () => {
    expect(isWabaInventory({ platform_type: "NOT_APPLICABLE", external_id: "9" })).toBe(false);
  });
});

describe("vistoNoUltimoSync", () => {
  const ultimo = "2026-10-08T09:30:00Z";
  it("conta o número lido no último sync", () => {
    expect(vistoNoUltimoSync({ last_synced_at: "2026-10-08T09:31:00Z" }, ultimo)).toBe(true);
  });
  it("tolera um dia de atraso do sync", () => {
    expect(vistoNoUltimoSync({ last_synced_at: "2026-10-07T09:30:00Z" }, ultimo)).toBe(true);
  });
  it("descarta a linha velha que o sync deixou para trás (migrou de WABA)", () => {
    // Legal é Viver: linhas de 22/07 sem platform_type somavam 21 em vez de 13.
    expect(vistoNoUltimoSync({ last_synced_at: "2026-07-22T09:30:00Z" }, ultimo)).toBe(false);
    expect(vistoNoUltimoSync({ last_synced_at: null }, ultimo)).toBe(false);
  });
});

describe("chaveTelefone", () => {
  it("casa o número com e sem o nono dígito", () => {
    expect(chaveTelefone("+55 71 9412-0467")).toBe(chaveTelefone("+55 71 99412-0467"));
  });
  it("não casa números diferentes", () => {
    expect(chaveTelefone("+55 71 9412-0467")).not.toBe(chaveTelefone("+55 71 9382-7730"));
  });
});

describe("capacidadeDoTier", () => {
  it("converte o tier da Meta em conversas/24h", () => {
    expect(capacidadeDoTier("TIER_100K")).toBe(100_000);
    expect(capacidadeDoTier("TIER_1K")).toBe(1_000);
    expect(capacidadeDoTier("TIER_250")).toBe(250);
  });
  it("ilimitado ou ausente não tem teto numérico", () => {
    expect(capacidadeDoTier("TIER_UNLIMITED")).toBeNull();
    expect(capacidadeDoTier(null)).toBeNull();
  });
});
