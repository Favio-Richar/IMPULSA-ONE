import { Module } from "@nestjs/common";
import { MercadoPagoCheckout, MercadoPagoOAuth, WebpayPlus } from "@impulza/payments";
import { mercadoPagoOAuthConfig } from "../../env.js";
import { CheckoutRefundsService } from "./checkout-refunds.service.js";
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY } from "./checkout.tokens.js";
import { MercadoPagoOAuthCallbackController, PaymentAccountsController } from "./payment-accounts.controller.js";
import { PaymentAccountsService } from "./payment-accounts.service.js";
import { MERCADO_PAGO_OAUTH } from "./payment-accounts.tokens.js";

// Cuenta de cobro de cada negocio (F5.8, ADR-013). Se exportan el servicio (el token del negocio) y
// el cliente de Checkout Pro con la clave de firma de los avisos: los usan los cobros de la tienda
// (F5.9) y las señas de reservas (F5.10).
@Module({
  controllers: [PaymentAccountsController, MercadoPagoOAuthCallbackController],
  providers: [
    PaymentAccountsService,
    CheckoutRefundsService,
    { provide: WEBPAY_PLUS_GATEWAY, useFactory: () => new WebpayPlus() },
    { provide: MERCADO_PAGO_OAUTH, useFactory: () => (mercadoPagoOAuthConfig ? new MercadoPagoOAuth(mercadoPagoOAuthConfig) : null) },
    {
      provide: MERCADO_PAGO_CHECKOUT,
      useFactory: () => (mercadoPagoOAuthConfig ? { checkout: new MercadoPagoCheckout(), webhookSecret: mercadoPagoOAuthConfig.webhookSecret } : null),
    },
  ],
  exports: [PaymentAccountsService, CheckoutRefundsService, MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY],
})
export class PaymentAccountsModule {}
