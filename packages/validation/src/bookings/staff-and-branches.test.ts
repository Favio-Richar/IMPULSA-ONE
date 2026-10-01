import { describe, expect, it } from "vitest";
import {
  bookingBranchSchema,
  updateBookingBranchSchema,
  bookingStaffSchema,
  updateBookingStaffSchema,
  assignStaffToServiceSchema,
} from "./staff-and-branches.js";

describe("esquemas de sucursales y profesionales (F7.9a)", () => {
  it("valida una sucursal correcta y limpia campos opcionales", () => {
    const valid = bookingBranchSchema.parse({
      name: "Sucursal Providencia",
      address: "Av. Providencia 1234, Of. 501",
      phone: "+56912345678",
      active: true,
      position: 1,
    });
    expect(valid.name).toBe("Sucursal Providencia");
    expect(valid.address).toBe("Av. Providencia 1234, Of. 501");
    expect(valid.position).toBe(1);

    // Mínimo válido
    const minimal = bookingBranchSchema.parse({ name: "Casa Matriz" });
    expect(minimal.name).toBe("Casa Matriz");
    expect(minimal.active).toBe(true);

    // Nombre inválido
    expect(() => bookingBranchSchema.parse({ name: "" })).toThrow();
  });

  it("actualiza sucursal permitiendo null para borrar dirección o teléfono", () => {
    const update = updateBookingBranchSchema.parse({
      address: null,
      phone: null,
      active: false,
    });
    expect(update.address).toBeNull();
    expect(update.phone).toBeNull();
    expect(update.active).toBe(false);
  });

  it("valida un profesional con y sin horario propio", () => {
    const staff = bookingStaffSchema.parse({
      name: "Dra. Sofía Rojas",
      title: "Odontóloga",
      email: "sofia@clinica.cl",
      phone: "+56987654321",
      serviceIds: ["a0000000-0000-4000-8000-000000000001"],
    });
    expect(staff.name).toBe("Dra. Sofía Rojas");
    expect(staff.serviceIds).toHaveLength(1);

    // Con horario semanal personalizado
    const staffWithHours = bookingStaffSchema.parse({
      name: "Carlos Barbero",
      weeklyHours: {
        mon: [{ start: "10:00", end: "14:00" }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    });
    expect(staffWithHours.weeklyHours?.mon).toHaveLength(1);

    // Correo inválido
    expect(() => bookingStaffSchema.parse({ name: "Juan", email: "no-es-correo" })).toThrow();
  });

  it("actualiza profesional permitiendo cambiar o vaciar campos", () => {
    const update = updateBookingStaffSchema.parse({
      title: null,
      weeklyHours: null,
      active: false,
    });
    expect(update.title).toBeNull();
    expect(update.weeklyHours).toBeNull();
    expect(update.active).toBe(false);
  });

  it("valida asignación de profesionales a un servicio", () => {
    const assignment = assignStaffToServiceSchema.parse({
      staffIds: ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"],
    });
    expect(assignment.staffIds).toHaveLength(2);
  });
});
