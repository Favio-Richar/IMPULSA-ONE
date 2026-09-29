import { describe, expect, it } from "vitest";
import { automationSentence } from "./automation-text";

describe("texto de automatizaciones (F6.7)", () => {
  it("cada regla se lee como una frase", () => {
    expect(automationSentence("contact_created", { type: "tag_contact", tag: "lead-web" })).toEqual({ when: "Llega un contacto nuevo", then: "Etiquetar al contacto con «lead-web»" });
    expect(automationSentence("order_created", { type: "set_commercial_status", status: "WON" }).then).toBe("Cambiar su estado comercial a «Ganado»");
    expect(automationSentence("booking_created", { type: "notify_team" }).then).toBe("Avisar al equipo por correo");
  });

  it("una acción guardada que ya no es válida se muestra como tal, sin romper", () => {
    expect(automationSentence("contact_created", { type: "webhook" }).then).toContain("no válida");
    expect(automationSentence("otro", { type: "notify_team" }).when).toBe("Evento desconocido");
  });
});
