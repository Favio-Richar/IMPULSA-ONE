import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { AppleWalletProvider, buildPassJson, solidPng } from "./apple-wallet.provider.js";
import { GoogleWalletProvider } from "./google-wallet.provider.js";
import { normalizePem, WalletUnavailableError, type WalletCardData } from "./wallet-pass.provider.js";

const card: WalletCardData = {
  serialNumber: "0123456789abcdef0123456789abcdef",
  siteName: "Estudio Luz",
  fullName: "Ana Pérez",
  jobTitle: "Fotógrafa",
  company: "Estudio Luz",
  email: "ana@estudioluz.cl",
  phone: "+56912345678",
  website: "https://estudioluz.cl",
  cardUrl: "https://impulza.cl/estudio-luz/t",
};

describe("Google Wallet (F10.4)", () => {
  it("emite un JWT RS256 verificable con la clave pública, con la clase y el objeto del pase", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const provider = new GoogleWalletProvider({
      issuerId: "3388000000012345678",
      serviceAccountEmail: "wallet@proyecto.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      origin: "https://impulza.cl",
    });
    expect(provider.isConfigured()).toBe(true);
    const result = await provider.create(card, new Date("2026-10-12T12:00:00Z"));
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.url.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);

    const jwt = result.url.slice("https://pay.google.com/gp/v/save/".length);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({ iss: "wallet@proyecto.iam.gserviceaccount.com", aud: "google", typ: "savetowallet", origins: ["https://impulza.cl"], iat: 1_791_806_400 });
    const object = claims.payload.genericObjects[0];
    expect(object).toMatchObject({ id: `3388000000012345678.card_${card.serialNumber}`, state: "ACTIVE", barcode: { type: "QR_CODE", value: card.cardUrl } });
    expect(object.header.defaultValue.value).toBe("Ana Pérez");
    expect(claims.payload.genericClasses[0].id).toBe("3388000000012345678.impulza_digital_card");
  });

  it("sin credenciales no emite nada", async () => {
    const provider = new GoogleWalletProvider(null);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.create(card)).rejects.toBeInstanceOf(WalletUnavailableError);
  });
});

describe("Apple Wallet (F10.4)", () => {
  function signerFixtures() {
    const make = (cn: string) => {
      const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const key = forge.pki.privateKeyFromPem(privatePem);
      const certificate = forge.pki.createCertificate();
      certificate.publicKey = forge.pki.setRsaPublicKey((key as forge.pki.rsa.PrivateKey).n, (key as forge.pki.rsa.PrivateKey).e);
      certificate.serialNumber = "01";
      certificate.validity.notBefore = new Date(Date.now() - 86_400_000);
      certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
      const attrs = [{ name: "commonName", value: cn }];
      certificate.setSubject(attrs);
      certificate.setIssuer(attrs);
      certificate.sign(key, forge.md.sha256.create());
      return { certificatePem: forge.pki.certificateToPem(certificate), privatePem, certificate };
    };
    return { signer: make("Pass Type ID: pass.cl.impulza.card"), wwdr: make("Apple Worldwide Developer Relations") };
  }

  it("arma un .pkpass: archivos esperados, manifiesto con SHA-1 correcto y firma PKCS#7 válida sobre él", async () => {
    const { signer, wwdr } = signerFixtures();
    const provider = new AppleWalletProvider({
      passTypeIdentifier: "pass.cl.impulza.card",
      teamIdentifier: "ABCDE12345",
      signerCertificate: signer.certificatePem,
      signerKey: signer.privatePem,
      wwdrCertificate: wwdr.certificatePem,
    });
    const result = await provider.create(card);
    expect(result).toMatchObject({ kind: "file", contentType: "application/vnd.apple.pkpass" });
    if (result.kind !== "file") return;

    const files = unzipSync(new Uint8Array(result.body));
    expect(Object.keys(files).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png", "manifest.json", "pass.json", "signature"]);

    // Cada archivo del manifiesto coincide con su SHA-1.
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!)) as Record<string, string>;
    for (const [name, hash] of Object.entries(manifest)) {
      expect(createHash("sha1").update(files[name]!).digest("hex")).toBe(hash);
    }
    expect(Object.keys(manifest).sort()).toEqual(["icon.png", "icon@2x.png", "icon@3x.png", "pass.json"]);

    const pass = JSON.parse(strFromU8(files["pass.json"]!));
    expect(pass).toMatchObject({ passTypeIdentifier: "pass.cl.impulza.card", teamIdentifier: "ABCDE12345", serialNumber: card.serialNumber });
    expect(pass.barcodes[0]).toMatchObject({ format: "PKBarcodeFormatQR", message: card.cardUrl });

    // La firma: PKCS#7 desprendido que cubre el SHA-256 del manifiesto y se verifica con el certificado del emisor.
    const message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(files.signature!).toString("binary")))) as unknown as {
      rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string };
    };
    const attributes = message.rawCapture.authenticatedAttributes;
    const digestAttribute = attributes.find((attribute) => forge.asn1.derToOid((attribute.value as forge.asn1.Asn1[])[0]!.value as string) === forge.pki.oids.messageDigest);
    const digestValue = ((((digestAttribute!.value as forge.asn1.Asn1[])[1]!.value as forge.asn1.Asn1[])[0]!).value as string);
    expect(Buffer.from(digestValue, "binary").toString("hex")).toBe(createHash("sha256").update(strFromU8(files["manifest.json"]!)).digest("hex"));

    const signedAttributes = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes);
    const md = forge.md.sha256.create();
    md.update(forge.asn1.toDer(signedAttributes).getBytes());
    expect((signer.certificate.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), message.rawCapture.signature)).toBe(true);
  });

  it("el pase solo lleva los campos que tienen valor", () => {
    const pass = buildPassJson({ passTypeIdentifier: "pass.x", teamIdentifier: "T" }, { ...card, jobTitle: null, email: null, phone: null, website: null }) as {
      generic: { secondaryFields: unknown[]; auxiliaryFields: unknown[]; backFields: Array<{ key: string }> };
    };
    expect(pass.generic.secondaryFields).toEqual([]);
    expect(pass.generic.auxiliaryFields).toEqual([]);
    expect(pass.generic.backFields.map((field) => field.key)).toEqual(["card"]);
  });

  it("el ícono es un PNG válido del tamaño pedido", () => {
    const png = solidPng(29, [17, 24, 39]);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(29);
    expect(png.readUInt32BE(20)).toBe(29);
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
  });

  it("sin credenciales no emite nada", async () => {
    const provider = new AppleWalletProvider(null);
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.create(card)).rejects.toBeInstanceOf(WalletUnavailableError);
  });
});

describe("variables de entorno (F10.4)", () => {
  it("las claves PEM admiten saltos de línea escritos como texto", () => {
    expect(normalizePem("-----BEGIN KEY-----\\nABC\\n-----END KEY-----")).toBe("-----BEGIN KEY-----\nABC\n-----END KEY-----");
  });
});
