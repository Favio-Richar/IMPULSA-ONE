import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import type { ProductCategoryResponse, ProductResponse, ProductVariantResponse } from "@impulza/contracts";
import { Prisma, type PrismaClient, type Product, type ProductCategory, type ProductFile, ProductFileStatus, type ProductVariant } from "@impulza/database";
import { productFileKey, type StorageAdapter } from "@impulza/storage";
import {
  IMAGE_ALT_REQUIRED_MESSAGE,
  MAX_CATEGORIES_PER_SITE,
  MAX_PRODUCTS_PER_SITE,
  MAX_VARIANTS_PER_PRODUCT,
  parseStoredProductImage,
  type ProductImage,
  type ProductCategoryInput,
  type ProductInput,
  type ProductVariantInput,
  type UpdateProductInput,
  type UpdateProductVariantInput,
} from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { PRIVATE_STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";

export const PRODUCT_NOT_FOUND = "Producto no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const FILE_BLOCKS_KIND_CHANGE = "Este producto tiene un archivo en venta: quítalo antes de cambiar el tipo de producto.";
export const VARIANT_NOT_FOUND = "Variante no encontrada: no existe, o pertenece a otro producto u organización (ADR-002).";
export const VARIANT_NAME_TAKEN = "Ya hay una variante con ese nombre en este producto.";
export const VARIANT_LIMIT = `Un producto admite hasta ${MAX_VARIANTS_PER_PRODUCT} variantes.`;
export const CATEGORY_NOT_FOUND = "Categoría no encontrada: no existe, o pertenece a otro sitio u organización (ADR-002).";

/** Imagen guardada en la base, o `null` si falta o dejó de ser válida. */
export function storedImage(value: Prisma.JsonValue | null): ProductImage | null {
  return parseStoredProductImage(value);
}

/** Regla de escritura (PP2): una imagen lleva texto alternativo o se marca como decorativa. */
function assertImageAlt(image: ProductImage | null | undefined): void {
  if (image && !image.decorative && image.alt.trim().length === 0) {
    throw new UnprocessableEntityException(IMAGE_ALT_REQUIRED_MESSAGE);
  }
}

/**
 * Catálogo de un sitio (F5.5): categorías y productos. Todo con alcance `organizationId + siteId`
 * (404 ante un id cruzado, ADR-002); escribir exige `catalog.manage`.
 */
@Injectable()
export class CatalogSetupService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    @Inject(PRIVATE_STORAGE) private readonly privateStorage: StorageAdapter | null,
  ) {}

  private async assertSiteInOrganization(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async assertCategory(organizationId: string, siteId: string, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) {
      return;
    }
    const category = await this.prisma.productCategory.findFirst({ where: { id: categoryId, siteId, organizationId }, select: { id: true } });
    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
  }

  // --- Categorías ---

  private toCategoryResponse(category: ProductCategory): ProductCategoryResponse {
    return {
      id: category.id,
      siteId: category.siteId,
      name: category.name,
      position: category.position,
      createdAt: category.createdAt.toISOString(),
    };
  }

  async listCategories(organizationId: string, siteId: string): Promise<ProductCategoryResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const categories = await this.prisma.productCategory.findMany({
      where: { siteId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return categories.map((category) => this.toCategoryResponse(category));
  }

  async createCategory(organizationId: string, actorId: string, siteId: string, input: ProductCategoryInput): Promise<ProductCategoryResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const count = await this.prisma.productCategory.count({ where: { siteId } });
    if (count >= MAX_CATEGORIES_PER_SITE) {
      throw new UnprocessableEntityException(`Un sitio admite hasta ${MAX_CATEGORIES_PER_SITE} categorías.`);
    }
    const created = await this.prisma.productCategory.create({ data: { organizationId, siteId, name: input.name, position: count } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.category_created",
      targetType: "ProductCategory",
      targetId: created.id,
      metadata: { siteId, name: created.name },
    });
    return this.toCategoryResponse(created);
  }

  async renameCategory(organizationId: string, actorId: string, siteId: string, categoryId: string, input: ProductCategoryInput): Promise<ProductCategoryResponse> {
    await this.assertCategory(organizationId, siteId, categoryId);
    const updated = await this.prisma.productCategory.update({ where: { id: categoryId }, data: { name: input.name } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.category_updated",
      targetType: "ProductCategory",
      targetId: categoryId,
      metadata: { siteId, name: updated.name },
    });
    return this.toCategoryResponse(updated);
  }

  /** Borra la categoría; sus productos quedan "sin categoría" (FK `SET NULL`), nunca se borran. */
  async deleteCategory(organizationId: string, actorId: string, siteId: string, categoryId: string): Promise<void> {
    await this.assertCategory(organizationId, siteId, categoryId);
    await this.prisma.productCategory.delete({ where: { id: categoryId } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.category_deleted",
      targetType: "ProductCategory",
      targetId: categoryId,
      metadata: { siteId },
    });
  }

  // --- Productos ---

  toVariantResponse(variant: ProductVariant): ProductVariantResponse {
    return {
      id: variant.id,
      productId: variant.productId,
      name: variant.name,
      priceAmount: variant.priceAmount,
      stock: variant.stock,
      sku: variant.sku,
      position: variant.position,
      active: variant.active,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    };
  }

  /** `readyFile`: el archivo en venta listo (F5.11b), si el producto lo tiene; `variants`, en orden (F7.8a). */
  toProductResponse(product: Product, readyFile: ProductFile | null = null, variants: ProductVariant[] = []): ProductResponse {
    return {
      id: product.id,
      siteId: product.siteId,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description,
      kind: product.kind,
      priceAmount: product.priceAmount,
      priceCurrency: product.priceCurrency,
      image: storedImage(product.image),
      paymentUrl: product.paymentUrl,
      stock: product.stock,
      active: product.active,
      position: product.position,
      downloadFile: readyFile
        ? {
            id: readyFile.id,
            fileName: readyFile.fileName,
            contentType: readyFile.contentType,
            sizeBytes: readyFile.sizeBytes,
            uploadedAt: (readyFile.readyAt ?? readyFile.createdAt).toISOString(),
          }
        : null,
      variants: variants.map((variant) => this.toVariantResponse(variant)),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  /** Variantes de un producto, en orden. */
  async variantsOf(productId: string): Promise<ProductVariant[]> {
    return this.prisma.productVariant.findMany({ where: { productId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  }

  /** El archivo listo de un producto, o `null`. */
  async readyFileOf(productId: string): Promise<ProductFile | null> {
    return this.prisma.productFile.findFirst({ where: { productId, status: ProductFileStatus.READY } });
  }

  private async getProductOrThrow(organizationId: string, siteId: string, productId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, siteId, organizationId } });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return product;
  }

  async listProducts(organizationId: string, siteId: string): Promise<ProductResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const products = await this.prisma.product.findMany({
      where: { siteId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        files: { where: { status: ProductFileStatus.READY }, take: 1 },
        variants: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      },
    });
    return products.map(({ files, variants, ...product }) => this.toProductResponse(product, files[0] ?? null, variants));
  }

  async createProduct(organizationId: string, actorId: string, siteId: string, input: ProductInput): Promise<ProductResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    await this.assertCategory(organizationId, siteId, input.categoryId);
    assertImageAlt(input.image);
    const count = await this.prisma.product.count({ where: { siteId } });
    if (count >= MAX_PRODUCTS_PER_SITE) {
      throw new UnprocessableEntityException(`Un sitio admite hasta ${MAX_PRODUCTS_PER_SITE} productos.`);
    }
    const created = await this.prisma.product.create({
      data: {
        organizationId,
        siteId,
        categoryId: input.categoryId ?? null,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        priceAmount: input.priceAmount,
        priceCurrency: input.priceCurrency,
        ...(input.image ? { image: input.image as Prisma.InputJsonValue } : {}),
        paymentUrl: input.paymentUrl ?? null,
        stock: input.stock ?? null,
        active: input.active,
        position: count,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.product_created",
      targetType: "Product",
      targetId: created.id,
      metadata: { siteId, name: created.name, kind: created.kind },
    });
    logger.info("producto creado", { organizationId, siteId, productId: created.id });
    return this.toProductResponse(created);
  }

  async updateProduct(organizationId: string, actorId: string, siteId: string, productId: string, changes: UpdateProductInput): Promise<ProductResponse> {
    const current = await this.getProductOrThrow(organizationId, siteId, productId);
    if (changes.categoryId !== undefined) {
      await this.assertCategory(organizationId, siteId, changes.categoryId);
    }
    if (changes.image) {
      assertImageAlt(changes.image);
    }
    const readyFile = await this.readyFileOf(current.id);
    // El archivo solo se entrega en productos digitales: cambiar el tipo lo dejaría huérfano.
    if (changes.kind !== undefined && changes.kind !== "DIGITAL" && readyFile) {
      throw new UnprocessableEntityException(FILE_BLOCKS_KIND_CHANGE);
    }
    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.kind === undefined ? {} : { kind: changes.kind }),
      ...(changes.priceAmount === undefined ? {} : { priceAmount: changes.priceAmount }),
      ...(changes.priceCurrency === undefined ? {} : { priceCurrency: changes.priceCurrency }),
      // `Prisma.DbNull` y no `null`: en una columna JSON, `null` llano no la deja en NULL.
      ...(changes.image === undefined ? {} : { image: changes.image === null ? Prisma.DbNull : (changes.image as Prisma.InputJsonValue) }),
      ...(changes.paymentUrl === undefined ? {} : { paymentUrl: changes.paymentUrl }),
      ...(changes.stock === undefined ? {} : { stock: changes.stock }),
      ...(changes.categoryId === undefined ? {} : { categoryId: changes.categoryId }),
      ...(changes.active === undefined ? {} : { active: changes.active }),
      ...(changes.position === undefined ? {} : { position: changes.position }),
    };
    const updated = await this.prisma.product.update({ where: { id: current.id }, data });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.product_updated",
      targetType: "Product",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(changes) },
    });
    return this.toProductResponse(updated, readyFile, await this.variantsOf(updated.id));
  }

  /**
   * Borra el producto; sus pedidos se conservan con su foto de datos (FK `SET NULL`). Sus archivos en
   * venta (F5.11b) se borran con él, también del bucket privado: sus descargas dejan de estar
   * disponibles (el panel lo advierte antes).
   */
  async deleteProduct(organizationId: string, actorId: string, siteId: string, productId: string): Promise<void> {
    const current = await this.getProductOrThrow(organizationId, siteId, productId);
    const files = await this.prisma.productFile.findMany({ where: { productId: current.id }, select: { id: true } });
    if (files.length > 0) {
      // Primero los objetos: si el bucket falla, el producto no se borra (nunca quedan archivos sin
      // dueño en el bucket privado) y se puede reintentar.
      if (!this.privateStorage) {
        throw new ServiceUnavailableException("No se puede borrar el archivo en venta ahora: el almacenamiento privado no está disponible.");
      }
      await this.privateStorage.deleteObjects(files.map((file) => productFileKey(organizationId, current.id, file.id)));
    }
    await this.prisma.product.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.product_deleted",
      targetType: "Product",
      targetId: current.id,
      metadata: { siteId, name: current.name },
    });
  }

  // --- Variantes (F7.8a, ADR-023) ---

  private async getVariantOrThrow(organizationId: string, siteId: string, productId: string, variantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, siteId, organizationId } });
    if (!variant) {
      throw new NotFoundException(VARIANT_NOT_FOUND);
    }
    return variant;
  }

  /** Respuesta del producto completo (con archivo y variantes) después de cambiar una variante. */
  private async productAfterVariantChange(product: Product): Promise<ProductResponse> {
    return this.toProductResponse(product, await this.readyFileOf(product.id), await this.variantsOf(product.id));
  }

  async createVariant(organizationId: string, actorId: string, siteId: string, productId: string, input: ProductVariantInput): Promise<ProductResponse> {
    const product = await this.getProductOrThrow(organizationId, siteId, productId);
    const count = await this.prisma.productVariant.count({ where: { productId: product.id } });
    if (count >= MAX_VARIANTS_PER_PRODUCT) {
      throw new UnprocessableEntityException(VARIANT_LIMIT);
    }
    let created: ProductVariant;
    try {
      created = await this.prisma.productVariant.create({
        data: {
          organizationId,
          siteId,
          productId: product.id,
          name: input.name,
          priceAmount: input.priceAmount ?? null,
          stock: input.stock ?? null,
          sku: input.sku ?? null,
          active: input.active,
          position: count,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(VARIANT_NAME_TAKEN);
      throw error;
    }
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.variant_created",
      targetType: "ProductVariant",
      targetId: created.id,
      metadata: { siteId, productId: product.id, name: created.name },
    });
    logger.info("variante creada", { organizationId, siteId, productId: product.id, variantId: created.id });
    return this.productAfterVariantChange(product);
  }

  async updateVariant(
    organizationId: string,
    actorId: string,
    siteId: string,
    productId: string,
    variantId: string,
    changes: UpdateProductVariantInput,
  ): Promise<ProductResponse> {
    const product = await this.getProductOrThrow(organizationId, siteId, productId);
    const current = await this.getVariantOrThrow(organizationId, siteId, product.id, variantId);
    try {
      await this.prisma.productVariant.update({
        where: { id: current.id },
        data: {
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.priceAmount === undefined ? {} : { priceAmount: changes.priceAmount }),
          ...(changes.stock === undefined ? {} : { stock: changes.stock }),
          ...(changes.sku === undefined ? {} : { sku: changes.sku }),
          ...(changes.active === undefined ? {} : { active: changes.active }),
          ...(changes.position === undefined ? {} : { position: changes.position }),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(VARIANT_NAME_TAKEN);
      throw error;
    }
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.variant_updated",
      targetType: "ProductVariant",
      targetId: current.id,
      metadata: { siteId, productId: product.id, fields: Object.keys(changes) },
    });
    return this.productAfterVariantChange(product);
  }

  /** Borra la variante; sus pedidos conservan nombre y precio (copia en la línea, FK `SET NULL`). */
  async deleteVariant(organizationId: string, actorId: string, siteId: string, productId: string, variantId: string): Promise<ProductResponse> {
    const product = await this.getProductOrThrow(organizationId, siteId, productId);
    const current = await this.getVariantOrThrow(organizationId, siteId, product.id, variantId);
    await this.prisma.productVariant.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "catalog.variant_deleted",
      targetType: "ProductVariant",
      targetId: current.id,
      metadata: { siteId, productId: product.id, name: current.name },
    });
    return this.productAfterVariantChange(product);
  }
}
