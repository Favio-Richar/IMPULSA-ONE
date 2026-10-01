import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PublicCatalogResponse, PublicCouponCheckResponse, PublicOrderConfirmationResponse } from "@impulza/contracts";
import type { Order, Prisma, PrismaClient } from "@impulza/database";
import {
  cartOrderSummaryName,
  MAX_ORDER_QUANTITY,
  ORDER_HONEYPOT_FIELD,
  productWithVariantName,
  publicCartCouponCheckSchema,
  publicCartOrderRequestSchema,
  publicCouponCheckSchema,
  publicOrderRequestSchema,
  type CartLine,
  type PublicCartOrderRequest,
} from "@impulza/validation";
import type { Request } from "express";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { AutomationEventsService } from "../automations/automation-events.service.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";
import { ContactsService } from "../contacts/contacts.service.js";
import { storedImage } from "./catalog-setup.service.js";
import { CouponsService } from "./coupons.service.js";
import { OrderCheckoutService } from "./order-checkout.service.js";
import { OrderNotifier } from "./order-notifier.js";

const NOT_AVAILABLE = "Este sitio no está recibiendo pedidos.";
export const PRODUCT_UNAVAILABLE = "Ese producto ya no está disponible.";
export const OUT_OF_STOCK = "No quedan suficientes unidades de ese producto.";
export const ADDRESS_REQUIRED = "Escribe la dirección de entrega.";
export const VARIANT_REQUIRED = "Elige una opción del producto.";
export const VARIANT_UNAVAILABLE = "Esa opción ya no está disponible.";
export const CART_MIXED_CURRENCY = "Tu carrito tiene productos con monedas distintas: pídelos por separado.";
export const CART_DIGITAL_ALONE = "Un producto digital se compra solo: pídelo por separado del resto del carrito.";

type ResolvedLine = Awaited<ReturnType<PublicCatalogService["resolveLine"]>>;

function badOrder(path: string, message: string): BadRequestException {
  return new BadRequestException({ message: "Revisa los datos del pedido.", issues: [{ path, message }] });
}

const ACTIVE_VARIANTS = { where: { active: true }, orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }] };

/** Tope de unidades por pedido según el stock (sin control de stock, el máximo general). */
function maxQuantityFor(stock: number | null): number {
  return stock === null ? MAX_ORDER_QUANTITY : Math.min(stock, MAX_ORDER_QUANTITY);
}

/**
 * Catálogo y pedidos desde la página pública (F5.5). Sin sesión: todo se resuelve por el slug del
 * sitio, solo si no está archivado y su organización está activa. Precio, moneda y enlace de pago
 * salen siempre del producto guardado — nunca de lo que mande el visitante. El stock se descuenta
 * con una actualización condicional (`stock >= cantidad`), así dos pedidos simultáneos nunca dejan
 * el stock en negativo (además del `CHECK` de la base).
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly contactsService: ContactsService,
    private readonly analyticsService: AnalyticsService,
    private readonly notifier: OrderNotifier,
    private readonly automationEvents: AutomationEventsService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly checkout: OrderCheckoutService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * Producto y variante que se piden, con su precio. La variante (F7.8a, ADR-023) la exige el
   * producto (si tiene activas), nunca lo que diga el visitante; y tiene que ser de **este** producto.
   */
  async resolveLine(siteId: string, productId: string, variantId: string | undefined) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, siteId, active: true }, include: { variants: ACTIVE_VARIANTS } });
    if (!product) {
      throw new NotFoundException(PRODUCT_UNAVAILABLE);
    }
    let variant: (typeof product.variants)[number] | null = null;
    if (product.variants.length > 0) {
      if (!variantId) {
        throw new BadRequestException({ message: "Revisa los datos del pedido.", issues: [{ path: "variantId", message: VARIANT_REQUIRED }] });
      }
      variant = product.variants.find((candidate) => candidate.id === variantId) ?? null;
      if (!variant) {
        throw new NotFoundException(VARIANT_UNAVAILABLE);
      }
    } else if (variantId) {
      throw new NotFoundException(VARIANT_UNAVAILABLE);
    }
    return { product, variant, unitPrice: variant?.priceAmount ?? product.priceAmount, lineName: productWithVariantName(product.name, variant?.name) };
  }

  /**
   * Probar un código antes de pedir (F7.8b): el descuento lo calcula el servidor con lo que se
   * pediría. Cualquier código que no aplica recibe el mismo 422, sin decir por qué.
   */
  async checkCoupon(siteSlug: string, rawBody: unknown): Promise<PublicCouponCheckResponse> {
    const parsed = publicCouponCheckSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Revisa los datos.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const input = parsed.data;
    const site = await this.siteOrThrow(siteSlug);
    const { product, unitPrice } = await this.resolveLine(site.id, input.productId, input.variantId);
    const subtotal = unitPrice * input.quantity;
    const { coupon, discount } = await this.coupons.resolve(site.id, input.code, subtotal, product.priceCurrency);
    return { code: coupon.code, subtotalAmount: subtotal, discountAmount: discount, totalAmount: subtotal - discount, priceCurrency: product.priceCurrency };
  }

  private async siteOrThrow(siteSlug: string) {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION },
      select: { id: true, organizationId: true, name: true },
    });
    if (!site) {
      throw new NotFoundException(NOT_AVAILABLE);
    }
    return site;
  }

  async catalog(siteSlug: string): Promise<PublicCatalogResponse> {
    const site = await this.siteOrThrow(siteSlug);
    const [categories, products] = await Promise.all([
      this.prisma.productCategory.findMany({ where: { siteId: site.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      this.prisma.product.findMany({
        where: { siteId: site.id, active: true },
        include: { variants: ACTIVE_VARIANTS },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    return {
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
      products: products.map((product) => {
        // Con variantes activas, la disponibilidad y el tope salen de las variantes (F7.8a).
        const variants = product.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          priceAmount: variant.priceAmount ?? product.priceAmount,
          available: variant.stock === null || variant.stock > 0,
          maxQuantity: maxQuantityFor(variant.stock),
        }));
        return {
          id: product.id,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          kind: product.kind,
          priceAmount: product.priceAmount,
          priceCurrency: product.priceCurrency,
          image: storedImage(product.image),
          available: variants.length > 0 ? variants.some((variant) => variant.available) : product.stock === null || product.stock > 0,
          maxQuantity: variants.length > 0 ? Math.max(...variants.map((variant) => variant.maxQuantity)) : maxQuantityFor(product.stock),
          variants,
        };
      }),
    };
  }

  async createOrder(siteSlug: string, rawBody: unknown, request: Request): Promise<PublicOrderConfirmationResponse> {
    const parsed = publicOrderRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Revisa los datos del pedido.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const input = parsed.data;
    const site = await this.siteOrThrow(siteSlug);
    const { product, variant, unitPrice, lineName } = await this.resolveLine(site.id, input.productId, input.variantId);
    // Un producto físico se entrega: la dirección la exige el producto, no lo que diga el visitante.
    if (product.kind === "PHYSICAL" && !input.address) {
      throw new BadRequestException({ message: "Revisa los datos del pedido.", issues: [{ path: "address", message: ADDRESS_REQUIRED }] });
    }
    // Cupón (F7.8b): se valida y calcula aquí; el uso se cuenta dentro de la transacción. Si no
    // aplica, el pedido no se hace (422): el visitante decide si sigue sin el descuento.
    const subtotal = unitPrice * input.quantity;
    const applied = input.couponCode ? await this.coupons.resolve(site.id, input.couponCode, subtotal, product.priceCurrency) : null;
    const discount = applied?.discount ?? 0;
    const total = subtotal - discount;
    const confirmation: PublicOrderConfirmationResponse = {
      productName: lineName,
      quantity: input.quantity,
      unitPriceAmount: unitPrice,
      totalAmount: total,
      priceCurrency: product.priceCurrency,
      discountAmount: discount,
      couponCode: applied?.coupon.code ?? null,
      // Un pedido gratis (cupón del 100 %) no tiene nada que pagar.
      paymentUrl: total > 0 ? product.paymentUrl : null,
      checkoutUrl: null,
    };

    // Antispam (mismo criterio que formularios y reservas): a un bot se le responde como si hubiera
    // pedido, sin guardar ni descontar nada.
    const honeypot = input[ORDER_HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.length > 0) {
      return confirmation;
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const stockSource = await this.reserveLineStock(tx, { product, variant }, input.quantity, OUT_OF_STOCK);
      const tracksStock = stockSource !== null;
      if (applied) {
        await this.coupons.redeem(tx, applied.coupon.id);
      }
      return tx.order.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          productId: product.id,
          productName: lineName,
          productKind: product.kind,
          unitPriceAmount: unitPrice,
          priceCurrency: product.priceCurrency,
          quantity: input.quantity,
          totalAmount: total,
          discountAmount: discount,
          couponId: applied?.coupon.id ?? null,
          couponCode: applied?.coupon.code ?? null,
          paymentUrl: total > 0 ? product.paymentUrl : null,
          customerName: input.name,
          customerEmail: input.email.toLowerCase(),
          customerPhone: input.phone ?? null,
          deliveryAddress: product.kind === "PHYSICAL" ? (input.address ?? null) : null,
          note: input.note ?? null,
          stockReserved: tracksStock,
          items: {
            create: {
              organizationId: site.organizationId,
              productId: product.id,
              variantId: variant?.id ?? null,
              productName: product.name,
              variantName: variant?.name ?? null,
              productKind: product.kind,
              unitPriceAmount: unitPrice,
              quantity: input.quantity,
              lineTotalAmount: unitPrice * input.quantity,
              stockSource,
              position: 0,
            },
          },
        },
      });
    });

    return this.afterOrderCreated({ order, site, input, request, subjectId: product.id, confirmation });
  }

  /**
   * Reserva el stock de una línea dentro de la transacción del pedido. Con variante, cuenta el stock
   * de la variante; sin ella, el del producto. Condicional (`stock >= cantidad`): dos pedidos a la vez
   * no dejan stock negativo. Devuelve de dónde reservó, para devolverlo exacto al cancelar.
   */
  private async reserveLineStock(
    tx: Prisma.TransactionClient,
    line: Pick<ResolvedLine, "product" | "variant">,
    quantity: number,
    outOfStockMessage: string,
  ): Promise<"variant" | "product" | null> {
    if (line.variant) {
      if (line.variant.stock === null) return null;
      const reserved = await tx.productVariant.updateMany({
        where: { id: line.variant.id, active: true, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (reserved.count === 0) throw new ConflictException(outOfStockMessage);
      return "variant";
    }
    if (line.product.stock === null) return null;
    const reserved = await tx.product.updateMany({ where: { id: line.product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
    if (reserved.count === 0) throw new ConflictException(outOfStockMessage);
    return "product";
  }

  /**
   * Lo que sigue a un pedido guardado, igual para un pedido suelto y uno de carrito: la ficha del
   * contacto (con consentimiento, ADR-004), su línea de tiempo, los eventos de analítica, el cobro en
   * línea si el negocio lo tiene, los avisos y los eventos para automatizaciones y webhooks.
   */
  private async afterOrderCreated(params: {
    order: Order;
    site: { id: string; organizationId: string; name: string };
    input: { name: string; email: string; phone?: string; marketingConsent?: boolean };
    request: Request;
    subjectId: string | null;
    confirmation: PublicOrderConfirmationResponse;
  }): Promise<PublicOrderConfirmationResponse> {
    const { order, site, input, request, subjectId, confirmation } = params;
    // Después de confirmar: la ficha del contacto (con consentimiento, ADR-004) y su línea de tiempo.
    const contactResult = await this.contactsService.findOrCreateFromSubmission({
      organizationId: site.organizationId,
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone,
      consentSource: `order:${site.id}`,
    });
    if (input.marketingConsent === true) {
      await this.contactsService.recordMarketingConsent(contactResult.contact.id, `order:${site.id}`);
    }
    const [linked] = await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: order.id }, data: { contactId: contactResult.contact.id }, include: { items: { orderBy: { position: "asc" } } } }),
      this.prisma.contactEvent.create({
        data: {
          contactId: contactResult.contact.id,
          type: "PURCHASE",
          payload: {
            orderId: order.id,
            productName: order.productName,
            quantity: order.quantity,
            totalAmount: order.totalAmount,
            priceCurrency: order.priceCurrency,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    await this.analyticsService.recordEvent({
      organizationId: site.organizationId,
      siteId: site.id,
      type: "order_created",
      request,
      subjectId,
      idempotencyKey: `order_created:${order.id}`,
    });
    if (contactResult.created) {
      await this.analyticsService.recordEvent({
        organizationId: site.organizationId,
        siteId: site.id,
        type: "lead_created",
        request,
        subjectId,
        idempotencyKey: `lead_created:${contactResult.contact.id}`,
      });
    }
    // Con la cuenta de Mercado Pago del negocio conectada, el pedido se cobra en línea (F5.9) y el
    // enlace externo deja de ofrecerse; si no, o si Mercado Pago falla, sigue como siempre.
    const charge = await this.checkout.startFor(linked);
    if (charge) {
      confirmation.checkoutUrl = charge.checkoutUrl;
      confirmation.paymentUrl = null;
    }
    await this.notifier.notifyReceived(charge ? { ...linked, paymentUrl: null } : linked, site.name, charge?.statusUrl);
    await this.notifier.notifyOwners(linked, site.name);
    await this.automationEvents.emit({ organizationId: site.organizationId, trigger: "order_created", subjectId: order.id, contactId: contactResult.contact.id });
    await this.webhookEvents.emit({ organizationId: site.organizationId, type: "order.created", subjectId: order.id });
    logger.info("pedido público creado", { organizationId: site.organizationId, siteId: site.id, orderId: order.id });
    return confirmation;
  }

  // --- Carrito (F7.8c, ADR-023) ---

  /** Resuelve todas las líneas y aplica las reglas del carrito: una moneda y un digital solo. */
  private async resolveCart(siteId: string, lines: CartLine[]): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];
    for (const line of lines) {
      resolved.push(await this.resolveLine(siteId, line.productId, line.variantId));
    }
    const currencies = new Set(resolved.map((line) => line.product.priceCurrency));
    if (currencies.size > 1) throw badOrder("lines", CART_MIXED_CURRENCY);
    if (resolved.length > 1 && resolved.some((line) => line.product.kind === "DIGITAL")) throw badOrder("lines", CART_DIGITAL_ALONE);
    return resolved;
  }

  /** Probar un código con el carrito completo: el descuento va sobre el subtotal de todas las líneas. */
  async checkCartCoupon(siteSlug: string, rawBody: unknown): Promise<PublicCouponCheckResponse> {
    const parsed = publicCartCouponCheckSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ message: "Revisa los datos.", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    }
    const site = await this.siteOrThrow(siteSlug);
    const resolved = await this.resolveCart(site.id, parsed.data.lines);
    const currency = resolved[0]!.product.priceCurrency;
    const subtotal = resolved.reduce((sum, line, index) => sum + line.unitPrice * parsed.data.lines[index]!.quantity, 0);
    const { coupon, discount } = await this.coupons.resolve(site.id, parsed.data.code, subtotal, currency);
    return { code: coupon.code, subtotalAmount: subtotal, discountAmount: discount, totalAmount: subtotal - discount, priceCurrency: currency };
  }

  /**
   * Pedido desde el carrito: varias líneas en un solo pedido. Todo se recalcula desde la base; el stock
   * de todas las líneas y el uso del cupón se reservan en una sola transacción (todo o nada). Las
   * columnas del pedido quedan como resumen (ADR-023 §3): con varias líneas, cantidad 1 y precio =
   * subtotal, así el cobro y las reglas de la base valen igual que para un pedido suelto.
   */
  async createCartOrder(siteSlug: string, rawBody: unknown, request: Request): Promise<PublicOrderConfirmationResponse> {
    const parsed = publicCartOrderRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Revisa los datos del pedido.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const input: PublicCartOrderRequest = parsed.data;
    const site = await this.siteOrThrow(siteSlug);
    const resolved = await this.resolveCart(site.id, input.lines);
    const needsAddress = resolved.some((line) => line.product.kind === "PHYSICAL");
    if (needsAddress && !input.address) throw badOrder("address", ADDRESS_REQUIRED);

    const currency = resolved[0]!.product.priceCurrency;
    const quantities = input.lines.map((line) => line.quantity);
    const subtotal = resolved.reduce((sum, line, index) => sum + line.unitPrice * quantities[index]!, 0);
    const applied = input.couponCode ? await this.coupons.resolve(site.id, input.couponCode, subtotal, currency) : null;
    const discount = applied?.discount ?? 0;
    const total = subtotal - discount;
    const single = resolved.length === 1;
    const first = resolved[0]!;
    const summaryName = cartOrderSummaryName(resolved.map((line) => line.lineName));
    const quantity = single ? quantities[0]! : 1;
    const unitPrice = single ? first.unitPrice : subtotal;
    // Un enlace de pago externo es de un producto: solo sirve si el pedido es de ese producto.
    const paymentUrl = single && total > 0 ? first.product.paymentUrl : null;
    // Tipo del resumen: físico si algo se entrega (pide dirección); si no, el de la primera línea.
    const kind = needsAddress ? "PHYSICAL" : first.product.kind;

    const confirmation: PublicOrderConfirmationResponse = {
      productName: summaryName,
      quantity,
      unitPriceAmount: unitPrice,
      totalAmount: total,
      priceCurrency: currency,
      discountAmount: discount,
      couponCode: applied?.coupon.code ?? null,
      paymentUrl,
      checkoutUrl: null,
    };
    const honeypot = input[ORDER_HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.length > 0) {
      return confirmation;
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const sources: Array<"variant" | "product" | null> = [];
      for (const [index, line] of resolved.entries()) {
        sources.push(await this.reserveLineStock(tx, line, quantities[index]!, `No quedan suficientes unidades de ${line.lineName}.`));
      }
      if (applied) {
        await this.coupons.redeem(tx, applied.coupon.id);
      }
      return tx.order.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          productId: single ? first.product.id : null,
          productName: summaryName,
          productKind: kind,
          unitPriceAmount: unitPrice,
          priceCurrency: currency,
          quantity,
          totalAmount: total,
          discountAmount: discount,
          couponId: applied?.coupon.id ?? null,
          couponCode: applied?.coupon.code ?? null,
          paymentUrl,
          customerName: input.name,
          customerEmail: input.email.toLowerCase(),
          customerPhone: input.phone ?? null,
          deliveryAddress: needsAddress ? (input.address ?? null) : null,
          note: input.note ?? null,
          stockReserved: sources.some((source) => source !== null),
          items: {
            create: resolved.map((line, index) => ({
              organizationId: site.organizationId,
              productId: line.product.id,
              variantId: line.variant?.id ?? null,
              productName: line.product.name,
              variantName: line.variant?.name ?? null,
              productKind: line.product.kind,
              unitPriceAmount: line.unitPrice,
              quantity: quantities[index]!,
              lineTotalAmount: line.unitPrice * quantities[index]!,
              stockSource: sources[index]!,
              position: index,
            })),
          },
        },
      });
    });

    return this.afterOrderCreated({ order, site, input, request, subjectId: single ? first.product.id : null, confirmation });
  }
}
