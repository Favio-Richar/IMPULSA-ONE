import { Module } from "@nestjs/common";
import { WebpayOneclickGateway } from "@impulza/payments";
import { webpayConfig } from "../../env.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingController, WebpayReturnController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { MERCHANT_GATEWAY } from "./merchant-gateway.token.js";

// Cobro de suscripciones (F4.6a, ADR-012). `AuthModule` aporta el adaptador de email.
@Module({
  imports: [AuthModule],
  controllers: [BillingController, WebpayReturnController],
  providers: [
    BillingService,
    { provide: MERCHANT_GATEWAY, useFactory: () => (webpayConfig ? new WebpayOneclickGateway(webpayConfig) : null) },
  ],
})
export class BillingModule {}
