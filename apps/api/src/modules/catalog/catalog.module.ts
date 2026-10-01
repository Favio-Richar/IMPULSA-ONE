import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AutomationsModule } from "../automations/automations.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { PaymentAccountsModule } from "../payment-accounts/payment-accounts.module.js";
import { CatalogSetupController } from "./catalog-setup.controller.js";
import { CatalogSetupService } from "./catalog-setup.service.js";
import { CouponsController } from "./coupons.controller.js";
import { CouponsService } from "./coupons.service.js";
import { ProductFilesController, PublicDownloadsController } from "./downloads.controller.js";
import { DownloadsService } from "./downloads.service.js";
import { OrderPaymentWebhookController, PublicOrderStatusController } from "./order-checkout.controller.js";
import { OrderCheckoutService } from "./order-checkout.service.js";
import { OrderNotifier } from "./order-notifier.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { ProductFilesService } from "./product-files.service.js";
import { PublicCatalogController } from "./public-catalog.controller.js";
import { PublicCatalogService } from "./public-catalog.service.js";

/**
 * Catálogo y pedidos (F5.5), su cobro con la cuenta de Mercado Pago del negocio (F5.9) y la entrega
 * de archivos comprados (F5.11b).
 */
@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule, AutomationsModule, PaymentAccountsModule],
  controllers: [
    CatalogSetupController,
    CouponsController,
    PublicCatalogController,
    OrdersController,
    OrderPaymentWebhookController,
    PublicOrderStatusController,
    ProductFilesController,
    PublicDownloadsController,
  ],
  providers: [CatalogSetupService, CouponsService, PublicCatalogService, OrdersService, OrderNotifier, OrderCheckoutService, ProductFilesService, DownloadsService],
})
export class CatalogModule {}
