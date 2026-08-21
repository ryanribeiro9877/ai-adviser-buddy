import { describe, it, expect } from "vitest";
import { isClickToWhatsApp, isWabaInventory } from "@/components/whatsapp-panel";

describe("isWabaInventory / isClickToWhatsApp", () => {
  it("trata CLOUD_API como inventário WABA", () => {
    expect(
      isWabaInventory({ platform_type: "CLOUD_API", external_id: "123" }),
    ).toBe(true);
  });

  it("trata ON_PREMISE e platform_type null (sync antigo) como WABA", () => {
    expect(isWabaInventory({ platform_type: "ON_PREMISE", external_id: "1" })).toBe(true);
    expect(isWabaInventory({ platform_type: null, external_id: "1075095699012418" })).toBe(
      true,
    );
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
