import type { WalletCardData, WalletPassProvider, WalletPassResult } from "./wallet-pass.provider.js";
import { WalletUnavailableError } from "./wallet-pass.provider.js";

/**
 * Simulador de un proveedor de wallet: corre en CI y en desarrollo sin credenciales y deja a la vista los datos con que se le pidió
 * el pase. Con `configured = false` se comporta como un proveedor sin credenciales.
 */
export class FakeWalletProvider implements WalletPassProvider {
  readonly requests: WalletCardData[] = [];

  constructor(
    readonly id: "google" | "apple",
    private configured = true,
  ) {}

  setConfigured(value: boolean): void {
    this.configured = value;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async create(card: WalletCardData): Promise<WalletPassResult> {
    if (!this.configured) throw new WalletUnavailableError(this.id);
    this.requests.push(card);
    if (this.id === "google") return { kind: "redirect", url: `https://pay.google.com/gp/v/save/fake.${card.serialNumber}` };
    return { kind: "file", contentType: "application/vnd.apple.pkpass", fileName: "tarjeta.pkpass", body: Buffer.from(`pkpass:${card.serialNumber}`) };
  }
}
