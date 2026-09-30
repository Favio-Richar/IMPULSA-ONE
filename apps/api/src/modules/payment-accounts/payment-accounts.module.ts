import { Module } from "@nestjs/common";
import { MercadoPagoOAuth } from "@impulza/payments";
import { mercadoPagoOAuthConfig } from "../../env.js";
import { MercadoPagoOAuthCallbackController, PaymentAccountsController } from "./payment-accounts.controller.js";
import { PaymentAccountsService } from "./payment-accounts.service.js";
import { MERCADO_PAGO_OAUTH } from "./payment-accounts.tokens.js";

// Cuenta de cobro de cada negocio (F5.8, ADR-013). Se exporta el servicio: los cobros de la tienda
// y las señas (F5.9, F5.10) piden el token del negocio por acá.
@Module({
  controllers: [PaymentAccountsController, MercadoPagoOAuthCallbackController],
  providers: [PaymentAccountsService, { provide: MERCADO_PAGO_OAUTH, useFactory: () => (mercadoPagoOAuthConfig ? new MercadoPagoOAuth(mercadoPagoOAuthConfig) : null) }],
  exports: [PaymentAccountsService],
})
export class PaymentAccountsModule {}
