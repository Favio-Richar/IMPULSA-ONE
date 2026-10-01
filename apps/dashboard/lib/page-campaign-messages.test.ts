import { describe, expect, it, vi } from "vitest";

// `api-client` valida las variables públicas al importarse; acá basta con valores de ejemplo.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL ??= "http://localhost:4000/api/v1";
  process.env.NEXT_PUBLIC_WEB_BASE_URL ??= "http://localhost:3300";
});

import { ApiError } from "./api-client";
import { formatRemaining, isoToLocalInput, localInputToIso, pageCampaignErrorMessage } from "./page-campaign-messages";

describe("mensajes del modo campaña (F7.7)", () => {
  it("los códigos propios muestran el mensaje de la API; el resto, uno genérico por estado", () => {
    expect(pageCampaignErrorMessage(new ApiError(409, { code: "PAGE_CAMPAIGN_OVERLAP", message: "Esa página ya está en otra campaña en esas fechas." }))).toBe(
      "Esa página ya está en otra campaña en esas fechas.",
    );
    expect(pageCampaignErrorMessage(new ApiError(409, { code: "HOME_TAKEOVER_OVERLAP", message: "Otra campaña ya toma el inicio." }))).toBe(
      "Otra campaña ya toma el inicio.",
    );
    // Un código desconocido nunca deja pasar su texto: podría no estar pensado para el usuario.
    expect(pageCampaignErrorMessage(new ApiError(422, { code: "OTRA_COSA", message: "detalle interno" }))).toBe("Revisa los datos de la campaña.");
    expect(pageCampaignErrorMessage(new ApiError(403, {}))).toMatch(/rol/);
    expect(pageCampaignErrorMessage(new ApiError(500, {}))).toMatch(/salió mal/);
    expect(pageCampaignErrorMessage(new TypeError("fetch failed"))).toMatch(/conectar/);
    expect(pageCampaignErrorMessage(null)).toBeNull();
  });

  it("la cuenta regresiva es legible y nunca dice 0 minutos", () => {
    expect(formatRemaining(10_000)).toBe("1 min");
    expect(formatRemaining(12 * 60_000)).toBe("12 min");
    expect(formatRemaining(5 * 3_600_000 + 20 * 60_000)).toBe("5 h 20 min");
    expect(formatRemaining(2 * 3_600_000)).toBe("2 h");
    expect(formatRemaining(3 * 86_400_000 + 5_000)).toBe("3 días");
  });

  it("la fecha local del formulario y el ISO del servidor van y vuelven sin perder el minuto", () => {
    const iso = "2026-12-01T13:45:00.000Z";
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("no-es-fecha")).toBeNull();
  });
});
