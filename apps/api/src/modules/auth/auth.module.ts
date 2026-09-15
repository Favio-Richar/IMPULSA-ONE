import { Module } from "@nestjs/common";
import { ConsoleEmailAdapter, type EmailAdapter } from "@impulza/auth";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { EMAIL_ADAPTER } from "./email-adapter.token.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      // ConsoleEmailAdapter hasta que exista un proveedor real configurado (Resend/SES) —
      // ver ARCHITECTURE.md §5 y packages/auth/src/email/EmailAdapter.ts.
      provide: EMAIL_ADAPTER,
      useFactory: (): EmailAdapter => new ConsoleEmailAdapter(),
    },
  ],
  exports: [AuthService, EMAIL_ADAPTER],
})
export class AuthModule {}
