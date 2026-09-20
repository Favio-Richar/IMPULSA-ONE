import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { PrismaModule } from "./database/prisma.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { BlocksModule } from "./modules/blocks/blocks.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { PagesModule } from "./modules/pages/pages.module.js";
import { PublicSitesModule } from "./modules/public-sites/public-sites.module.js";
import { SitesModule } from "./modules/sites/sites.module.js";
import { ThemesModule } from "./modules/themes/themes.module.js";
import { RedisModule } from "./redis/redis.module.js";

// Módulo raíz — los módulos de dominio (sites, forms, ...) se agregan a partir de Fase 2, uno
// por historia del backlog. Ver docs/BACKLOG_FASE_0_1.md.
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    ThemesModule,
    SitesModule,
    PagesModule,
    BlocksModule,
    PublicSitesModule,
    HealthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
