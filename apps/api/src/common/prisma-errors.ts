import { Prisma } from "@impulza/database";

// P2002 = violación de restricción única en Prisma. La comprobación previa de disponibilidad de
// slug deja una ventana de carrera (dos peticiones simultáneas la pasan y una pierde en el
// INSERT); la restricción de la base de datos es la que decide de verdad. Traducirla a 409 evita
// que esa carrera se vea como un 500.
//
// Centralizado acá porque tres servicios distintos lo necesitan con el mismo criterio: sitios,
// páginas, y el restaurar de un historial de páginas (F2.6) — la regla de tres para dejar de
// duplicarlo.
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
