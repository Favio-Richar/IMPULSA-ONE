import { Global, Module } from "@nestjs/common";
import { prisma } from "@impulza/database";

export const PRISMA = Symbol("PRISMA");

// Global: casi todo módulo de dominio necesita la base de datos; evita repetir el import en
// cada feature module (patrón estándar de Nest para providers muy transversales).
@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class PrismaModule {}
