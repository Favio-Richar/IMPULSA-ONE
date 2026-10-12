import { Module } from "@nestjs/common";
import { env } from "../../env.js";
import { DigitalCardController } from "./digital-card.controller.js";
import { DigitalCardService } from "./digital-card.service.js";
import { WALLET_PASS_PROVIDERS } from "./digital-card.tokens.js";
import { PublicDigitalCardController } from "./public-digital-card.controller.js";
import { AppleWalletProvider } from "./wallet/apple-wallet.provider.js";
import { GoogleWalletProvider } from "./wallet/google-wallet.provider.js";

/** Todas las variables de un proveedor o ninguna: una configuración a medias se trata como «sin configurar». */
function googleConfig() {
  const { GOOGLE_WALLET_ISSUER_ID: issuerId, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_WALLET_PRIVATE_KEY: privateKey, PUBLIC_SITE_BASE_URL } = env;
  if (!issuerId || !serviceAccountEmail || !privateKey || !PUBLIC_SITE_BASE_URL) return null;
  return { issuerId, serviceAccountEmail, privateKey, origin: new URL(PUBLIC_SITE_BASE_URL).origin };
}

function appleConfig() {
  const { APPLE_WALLET_PASS_TYPE_ID: passTypeIdentifier, APPLE_WALLET_TEAM_ID: teamIdentifier, APPLE_WALLET_SIGNER_CERT, APPLE_WALLET_SIGNER_KEY, APPLE_WALLET_WWDR_CERT } = env;
  if (!passTypeIdentifier || !teamIdentifier || !APPLE_WALLET_SIGNER_CERT || !APPLE_WALLET_SIGNER_KEY || !APPLE_WALLET_WWDR_CERT) return null;
  return { passTypeIdentifier, teamIdentifier, signerCertificate: APPLE_WALLET_SIGNER_CERT, signerKey: APPLE_WALLET_SIGNER_KEY, wwdrCertificate: APPLE_WALLET_WWDR_CERT };
}

// Tarjeta digital del sitio, vCard y pases de wallet (F10.4, ADR-029). Los proveedores salen del entorno; sin credenciales la
// tarjeta y la vCard siguen funcionando y el pase responde «no disponible».
@Module({
  controllers: [PublicDigitalCardController, DigitalCardController],
  providers: [
    DigitalCardService,
    { provide: WALLET_PASS_PROVIDERS, useFactory: () => [new GoogleWalletProvider(googleConfig()), new AppleWalletProvider(appleConfig())] },
  ],
})
export class DigitalCardModule {}
