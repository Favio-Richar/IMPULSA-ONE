import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AutomationsModule } from "../automations/automations.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { CatalogSetupController } from "./catalog-setup.controller.js";
import { CatalogSetupService } from "./catalog-setup.service.js";
import { OrderNotifier } from "./order-notifier.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { PublicCatalogController } from "./public-catalog.controller.js";
import { PublicCatalogService } from "./public-catalog.service.js";

/** Catálogo y pedidos (F5.5). */
@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule, AutomationsModule],
  controllers: [CatalogSetupController, PublicCatalogController, OrdersController],
  providers: [CatalogSetupService, PublicCatalogService, OrdersService, OrderNotifier],
})
export class CatalogModule {}
