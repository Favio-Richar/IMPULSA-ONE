import { createSign } from "node:crypto";
import { normalizePem, WalletUnavailableError, type WalletCardData, type WalletPassProvider, type WalletPassResult } from "./wallet-pass.provider.js";

export interface GoogleWalletConfig {
  issuerId: string;
  serviceAccountEmail: string;
  /** Clave privada PEM de la cuenta de servicio. */
  privateKey: string;
  /** Origen del sitio que ofrece el botón (lo exige Google en `origins`). */
  origin: string;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString("base64url");
const text = (value: string) => ({ defaultValue: { language: "es", value } });

/** Identificador de clase y de objeto: solo letras, números, punto, guion y guion bajo. */
const safeId = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Google Wallet: «Guardar en Google Wallet» con un JWT firmado (RS256) que lleva la clase y el objeto del pase, así que no hace
 * falta crear nada antes en la cuenta del emisor. El JWT se firma con la clave de la cuenta de servicio; nunca sale de la API.
 */
export class GoogleWalletProvider implements WalletPassProvider {
  readonly id = "google" as const;

  constructor(private readonly config: GoogleWalletConfig | null) {}

  isConfigured(): boolean {
    return this.config !== null;
  }

  async create(card: WalletCardData, now: Date = new Date()): Promise<WalletPassResult> {
    if (!this.config) throw new WalletUnavailableError("google");
    const { issuerId, serviceAccountEmail, origin } = this.config;
    const classId = `${issuerId}.${safeId("impulza_digital_card")}`;
    const objectId = `${issuerId}.${safeId(`card_${card.serialNumber}`)}`;

    const modules = [
      card.email ? { id: "email", header: "Correo", body: card.email } : null,
      card.phone ? { id: "phone", header: "Teléfono", body: card.phone } : null,
      card.company ? { id: "company", header: "Empresa", body: card.company } : null,
    ].filter((item): item is { id: string; header: string; body: string } => item !== null);
    const links = [
      { id: "card", description: "Mi tarjeta digital", uri: card.cardUrl },
      ...(card.website ? [{ id: "website", description: "Sitio web", uri: card.website }] : []),
    ];

    const genericObject = {
      id: objectId,
      classId,
      state: "ACTIVE",
      hexBackgroundColor: "#111827",
      cardTitle: text(card.siteName),
      header: text(card.fullName),
      ...(card.jobTitle ? { subheader: text(card.jobTitle) } : {}),
      barcode: { type: "QR_CODE", value: card.cardUrl },
      textModulesData: modules,
      linksModuleData: { uris: links },
    };

    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(now.getTime() / 1000),
      origins: [origin],
      payload: { genericClasses: [{ id: classId }], genericObjects: [genericObject] },
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(normalizePem(this.config.privateKey));
    return { kind: "redirect", url: `https://pay.google.com/gp/v/save/${unsigned}.${base64url(signature)}` };
  }
}
