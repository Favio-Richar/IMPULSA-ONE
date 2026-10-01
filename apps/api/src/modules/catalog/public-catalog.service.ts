import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PublicCatalogResponse, PublicOrderConfirmationResponse } from "@impulza/contracts";
import type { Prisma, PrismaClient } from "@impulza/database";
import { MAX_ORDER_QUANTITY, ORDER_HONEYPOT_FIELD, productWithVariantName, publicOrderRequestSchema } from "@impulza/validation";
import type { Request } from "express";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { AutomationEventsService } from "../automations/automation-events.service.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";
import { ContactsService } from "../contacts/contacts.service.js";
import { storedImage } from "./catalog-setup.service.js";
import { OrderCheckoutService } from "./order-checkout.service.js";
import { OrderNotifier } from "./order-notifier.js";

const NOT_AVAILABLE = "Este sitio no está recibiendo pedidos.";
export const PRODUCT_UNAVAILABLE = "Ese producto ya no está disponible.";
export const OUT_OF_STOCK = "No quedan suficientes unidades de ese producto.";
export const ADDRESS_REQUIRED = "Escribe la dirección de entrega.";
export const VARIANT_REQUIRED = "Elige una opción del producto.";
export const VARIANT_UNAVAILABLE = "Esa opción ya no está disponible.";

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
  ) {}

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
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, siteId: site.id, active: true }, include: { variants: ACTIVE_VARIANTS } });
    if (!product) {
      throw new NotFoundException(PRODUCT_UNAVAILABLE);
    }
    // Variante (F7.8a, ADR-023): la exige el producto (si tiene activas), nunca lo que diga el
    // visitante; y tiene que ser una variante activa de **este** producto.
    let variant: (typeof product.variants)[number] | null = null;
    if (product.variants.length > 0) {
      if (!input.variantId) {
        throw new BadRequestException({ message: "Revisa los datos del pedido.", issues: [{ path: "variantId", message: VARIANT_REQUIRED }] });
      }
      variant = product.variants.find((candidate) => candidate.id === input.variantId) ?? null;
      if (!variant) {
        throw new NotFoundException(VARIANT_UNAVAILABLE);
      }
    } else if (input.variantId) {
      throw new NotFoundException(VARIANT_UNAVAILABLE);
    }
    const unitPrice = variant?.priceAmount ?? product.priceAmount;
    const lineName = productWithVariantName(product.name, variant?.name);
    // Un producto físico se entrega: la dirección la exige el producto, no lo que diga el visitante.
    if (product.kind === "PHYSICAL" && !input.address) {
      throw new BadRequestException({ message: "Revisa los datos del pedido.", issues: [{ path: "address", message: ADDRESS_REQUIRED }] });
    }
    const confirmation: PublicOrderConfirmationResponse = {
      productName: lineName,
      quantity: input.quantity,
      unitPriceAmount: unitPrice,
      totalAmount: unitPrice * input.quantity,
      priceCurrency: product.priceCurrency,
      paymentUrl: product.paymentUrl,
      checkoutUrl: null,
    };

    // Antispam (mismo criterio que formularios y reservas): a un bot se le responde como si hubiera
    // pedido, sin guardar ni descontar nada.
    const honeypot = input[ORDER_HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.length > 0) {
      return confirmation;
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Con variante, el stock que cuenta es el de la variante; sin ella, el del producto. El
      // descuento es condicional (`stock >= cantidad`): dos pedidos a la vez no dejan stock negativo.
      let stockSource: "variant" | "product" | null = null;
      if (variant) {
        if (variant.stock !== null) {
          const reserved = await tx.productVariant.updateMany({
            where: { id: variant.id, active: true, stock: { gte: input.quantity } },
            data: { stock: { decrement: input.quantity } },
          });
          if (reserved.count === 0) {
            throw new ConflictException(OUT_OF_STOCK);
          }
          stockSource = "variant";
        }
      } else if (product.stock !== null) {
        const reserved = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: input.quantity } },
          data: { stock: { decrement: input.quantity } },
        });
        if (reserved.count === 0) {
          throw new ConflictException(OUT_OF_STOCK);
        }
        stockSource = "product";
      }
      const tracksStock = stockSource !== null;
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
          totalAmount: unitPrice * input.quantity,
          paymentUrl: product.paymentUrl,
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
      this.prisma.order.update({ where: { id: order.id }, data: { contactId: contactResult.contact.id } }),
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
      subjectId: product.id,
      idempotencyKey: `order_created:${order.id}`,
    });
    if (contactResult.created) {
      await this.analyticsService.recordEvent({
        organizationId: site.organizationId,
        siteId: site.id,
        type: "lead_created",
        request,
        subjectId: product.id,
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
}
