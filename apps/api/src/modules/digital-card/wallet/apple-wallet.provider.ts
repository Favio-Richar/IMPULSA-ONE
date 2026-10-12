import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { zipSync, strToU8 } from "fflate";
import forge from "node-forge";
import { normalizePem, WalletUnavailableError, type WalletCardData, type WalletPassProvider, type WalletPassResult } from "./wallet-pass.provider.js";

export interface AppleWalletConfig {
  passTypeIdentifier: string;
  teamIdentifier: string;
  /** Certificado y clave del identificador de pase (PEM). */
  signerCertificate: string;
  signerKey: string;
  /** Certificado intermedio de Apple (WWDR, PEM). */
  wwdrCertificate: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG cuadrado de un solo color: Apple exige `icon.png`; así el pase no depende de imágenes externas. */
export function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profundidad
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** `pass.json` de un pase genérico con la tarjeta; solo incluye los campos que tienen valor. */
export function buildPassJson(config: Pick<AppleWalletConfig, "passTypeIdentifier" | "teamIdentifier">, card: WalletCardData): Record<string, unknown> {
  const field = (key: string, label: string, value: string | null) => (value ? [{ key, label, value }] : []);
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    serialNumber: card.serialNumber,
    organizationName: card.company ?? card.siteName,
    description: `Tarjeta digital de ${card.fullName}`,
    logoText: card.siteName,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(17, 24, 39)",
    labelColor: "rgb(203, 213, 225)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: card.cardUrl, messageEncoding: "iso-8859-1" }],
    generic: {
      primaryFields: [{ key: "name", label: "NOMBRE", value: card.fullName }],
      secondaryFields: field("title", "CARGO", card.jobTitle),
      auxiliaryFields: [...field("phone", "TELÉFONO", card.phone), ...field("email", "CORREO", card.email)],
      backFields: [...field("website", "Sitio web", card.website), { key: "card", label: "Tarjeta digital", value: card.cardUrl }],
    },
  };
}

/** Firma separada (PKCS#7) del manifiesto con el certificado del identificador de pase y la cadena de Apple. */
export function signManifest(manifest: string, config: Pick<AppleWalletConfig, "signerCertificate" | "signerKey" | "wwdrCertificate">): Buffer {
  const certificate = forge.pki.certificateFromPem(normalizePem(config.signerCertificate));
  const wwdr = forge.pki.certificateFromPem(normalizePem(config.wwdrCertificate));
  const key = forge.pki.privateKeyFromPem(normalizePem(config.signerKey));
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest, "utf8");
  p7.addCertificate(certificate);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}

/**
 * Apple Wallet: un `.pkpass` (zip) con `pass.json`, los íconos, el manifiesto con el SHA-1 de cada archivo y su firma. La
 * firma usa el certificado del propio negocio emisor de la plataforma; sin las credenciales no se emite nada.
 */
export class AppleWalletProvider implements WalletPassProvider {
  readonly id = "apple" as const;

  constructor(private readonly config: AppleWalletConfig | null) {}

  isConfigured(): boolean {
    return this.config !== null;
  }

  async create(card: WalletCardData): Promise<WalletPassResult> {
    if (!this.config) throw new WalletUnavailableError("apple");
    const files: Record<string, Buffer> = {
      "pass.json": Buffer.from(JSON.stringify(buildPassJson(this.config, card)), "utf8"),
      "icon.png": solidPng(29, [17, 24, 39]),
      "icon@2x.png": solidPng(58, [17, 24, 39]),
      "icon@3x.png": solidPng(87, [17, 24, 39]),
    };
    const manifest = JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, createHash("sha1").update(content).digest("hex")])));
    const signature = signManifest(manifest, this.config);
    const archive = zipSync({
      ...Object.fromEntries(Object.entries(files).map(([name, content]) => [name, new Uint8Array(content)])),
      "manifest.json": strToU8(manifest),
      signature: new Uint8Array(signature),
    });
    return { kind: "file", contentType: "application/vnd.apple.pkpass", fileName: "tarjeta.pkpass", body: Buffer.from(archive) };
  }
}
