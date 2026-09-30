import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

// Protección SSRF de los webhooks salientes (ADR-017 §1). La URL ya pasó la validación de forma
// (`webhookUrlSchema`); acá se decide **al conectar** a qué IP se llega: el `lookup` de la conexión
// solo devuelve direcciones públicas, así que un dominio que resuelve (o pasa a resolver) a la red
// interna o a la metadata de la nube no se alcanza nunca. Una IP literal no pasa por `lookup` (Node
// conecta directo): `sendWebhook` la revisa antes con `isPublicAddress`.

// Dos listas separadas a propósito: `BlockList` compara una IPv4 también contra los rangos IPv6 que
// la contienen (`::ffff:0:0/96`), y una sola lista con ese rango bloquearía toda IPv4.
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "esta red"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incluye la metadata de la nube, 169.254.169.254)
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // asignaciones de protocolo IETF
  ["192.0.2.0", 24], // documentación
  ["192.88.99.0", 24], // relé 6to4
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // pruebas de rendimiento
  ["198.51.100.0", 24], // documentación
  ["203.0.113.0", 24], // documentación
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada (incluye 255.255.255.255)
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], // no especificada
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: esconde una IPv4
  ["64:ff9b:1::", 48], // NAT64 local
  ["100::", 64], // descarte
  ["2001::", 32], // Teredo: esconde una IPv4
  ["2001:db8::", 32], // documentación
  ["2002::", 16], // 6to4: esconde una IPv4
  ["fc00::", 7], // ULA (privada)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (obsoleta)
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

/** IPv4 escondida en una IPv6 mapeada (`::ffff:a.b.c.d` o `::ffff:0a00:0001`), o `null`. */
function mappedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return null;
}

/** `true` si la dirección es enrutable en internet público. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) {
    // Una IPv6 mapeada se juzga por la IPv4 que esconde (y nunca hace falta para salir: se trata como no pública).
    const embedded = mappedIpv4(address);
    if (embedded !== null) return false;
    return !blockedV6.check(address, "ipv6");
  }
  return false;
}

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` para `https.request`: resuelve todas las direcciones del host y, si **alguna** no es
 * pública, rechaza la conexión entera (un host con una IP pública y otra privada no se usa: la
 * elección entre ellas no la controlamos). Devuelve solo direcciones ya validadas.
 */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number } | number, callback: LookupCallback): void {
  const wantsAll = typeof options === "object" && options.all === true;
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, wantsAll ? [] : "");
      return;
    }
    const list = addresses as LookupAddress[];
    if (list.length === 0) {
      callback(new UnsafeDestinationError(`${hostname} no tiene direcciones.`), wantsAll ? [] : "");
      return;
    }
    const unsafe = list.find((entry) => !isPublicAddress(entry.address));
    if (unsafe) {
      callback(new UnsafeDestinationError("La dirección apunta a una red interna o reservada."), wantsAll ? [] : "");
      return;
    }
    if (wantsAll) callback(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
}
