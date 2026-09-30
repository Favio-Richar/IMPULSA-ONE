import { Module } from "@nestjs/common";
import { MercadoPagoCheckout } from "@impulza/payments";
import { mercadoPagoOAuthConfig } from "../../env.js";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AutomationsModule } from "../automations/automations.module.js";
import { ContactsModule } from "../contacts/contacts.module.js";
import { PaymentAccountsModule } from "../payment-accounts/payment-accounts.module.js";
import { CatalogSetupController } from "./catalog-setup.controller.js";
import { CatalogSetupService } from "./catalog-setup.service.js";
import { OrderPaymentWebhookController, PublicOrderStatusController } from "./order-checkout.controller.js";
import { OrderCheckoutService } from "./order-checkout.service.js";
import { ORDER_CHECKOUT } from "./order-checkout.tokens.js";
import { OrderNotifier } from "./order-notifier.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { PublicCatalogController } from "./public-catalog.controller.js";
import { PublicCatalogService } from "./public-catalog.service.js";

/** Catálogo y pedidos (F5.5), y su cobro con la cuenta de Mercado Pago del negocio (F5.9). */
@Module({
  imports: [ContactsModule, AnalyticsModule, AuthModule, AutomationsModule, PaymentAccountsModule],
  controllers: [CatalogSetupController, PublicCatalogController, OrdersController, OrderPaymentWebhookController, PublicOrderStatusController],
  providers: [
    CatalogSetupService,
    PublicCatalogService,
    OrdersService,
    OrderNotifier,
    OrderCheckoutService,
    {
      provide: ORDER_CHECKOUT,
      useFactory: () => (mercadoPagoOAuthConfig ? { checkout: new MercadoPagoCheckout(), webhookSecret: mercadoPagoOAuthConfig.webhookSecret } : null),
    },
  ],
})
export class CatalogModule {}
