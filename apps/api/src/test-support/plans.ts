import type { PrismaClient } from "@impulza/database";

/**
 * Pone una organización de prueba en un plan con cupo holgado (F4.2). Para las pruebas que
 * verifican **otra** cosa (permisos por rol, aislamiento, auditoría...) y necesitan invitar miembros
 * o crear varios recursos: con el plan Gratis, el límite respondería 402 antes de llegar a lo que
 * se quiere probar. Explícito a propósito — nunca un interruptor global que apague los límites, que
 * escondería justo lo que F4.2 tiene que garantizar. Las pruebas de límites usan Gratis tal cual.
 */
export async function assignRoomyPlan(prisma: PrismaClient, organizationId: string): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: organizationId }, data: { planId: plan.id } });
}
