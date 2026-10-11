import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentAccountsModule } from "../payment-accounts/payment-accounts.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";
import {
  MembershipPaymentWebhookController,
  MembershipPlansController,
  PublicMembershipPlansController,
  WebpayMembershipReturnController,
  PublicMembershipStatusController,
} from "./membership.controllers.js";
import { MembershipCheckoutService } from "./membership-checkout.service.js";
import { MembershipLifecycleRunner } from "./membership-lifecycle.runner.js";
import { MembershipLifecycleService } from "./membership-lifecycle.service.js";
import { MembershipPlansService } from "./membership-plans.service.js";
import { PublicMembersController } from "./public-members.controller.js";

// Miembros de sitio, contenido protegido (F10.1) y planes de membresía con cobro por la cuenta del negocio (F10.2, ADR-029).
// `AuthModule` aporta el adaptador de correo; `PublicSitesModule`, el render de la página y la invalidación de caché;
// `PaymentAccountsModule`, la cuenta de Mercado Pago del negocio y la firma de los avisos.
//
// Los controladores de planes van ANTES del de miembros: `members/plans` no debe leerse como un `:memberId`.
@Module({
  imports: [AuthModule, PublicSitesModule, PaymentAccountsModule],
  controllers: [
    PublicMembersController,
    PublicMembershipPlansController,
    PublicMembershipStatusController,
    MembershipPaymentWebhookController,
    WebpayMembershipReturnController,
    MembershipPlansController,
    MembersController,
  ],
  providers: [MembersService, MembershipPlansService, MembershipCheckoutService, MembershipLifecycleService, MembershipLifecycleRunner],
})
export class MembersModule {}
