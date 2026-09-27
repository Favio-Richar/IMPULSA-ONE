import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { productCategoryResponse, productResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  productCategorySchema,
  productSchema,
  updateProductSchema,
  type ProductCategoryInput,
  type ProductInput,
  type UpdateProductInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { CATEGORY_NOT_FOUND, CatalogSetupService, PRODUCT_NOT_FOUND } from "./catalog-setup.service.js";

@ApiTags("catalog")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/catalog")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class CatalogSetupController {
  constructor(private readonly catalogSetupService: CatalogSetupService) {}

  @Get("categories")
  @ApiOperation({ summary: "Listar las categorías del catálogo" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, productCategoryResponse, "Categorías, en su orden.")
  listCategories(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.catalogSetupService.listCategories(organizationId, siteId);
  }

  @Post("categories")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Crear una categoría", description: "Requiere `catalog.manage`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(productCategorySchema)
  @ApiZodResponse(201, productCategoryResponse, "Categoría creada.")
  @ApiResponse({ status: 422, description: "El sitio ya tiene el máximo de categorías." })
  createCategory(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(productCategorySchema)) body: ProductCategoryInput,
  ) {
    return this.catalogSetupService.createCategory(organizationId, user.id, siteId, body);
  }

  @Patch("categories/:categoryId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Renombrar una categoría", description: "Requiere `catalog.manage`." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("categoryId", "Categoría a renombrar.")
  @ApiZodBody(productCategorySchema)
  @ApiZodResponse(200, productCategoryResponse, "Categoría actualizada.")
  @ApiResponse({ status: 404, description: CATEGORY_NOT_FOUND })
  renameCategory(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("categoryId") categoryId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(productCategorySchema)) body: ProductCategoryInput,
  ) {
    return this.catalogSetupService.renameCategory(organizationId, user.id, siteId, categoryId, body);
  }

  @Delete("categories/:categoryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Borrar una categoría", description: "Requiere `catalog.manage`. Sus productos quedan sin categoría." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("categoryId", "Categoría a borrar.")
  @ApiResponse({ status: 204, description: "Categoría borrada." })
  @ApiResponse({ status: 404, description: CATEGORY_NOT_FOUND })
  async deleteCategory(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("categoryId") categoryId: string,
    @CurrentUser() user: User,
  ) {
    await this.catalogSetupService.deleteCategory(organizationId, user.id, siteId, categoryId);
  }

  @Get("products")
  @ApiOperation({ summary: "Listar los productos del catálogo" })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodArrayResponse(200, productResponse, "Productos, en su orden.")
  listProducts(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.catalogSetupService.listProducts(organizationId, siteId);
  }

  @Post("products")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: "Crear un producto",
    description: "Requiere `catalog.manage`. Físico, digital o servicio. El enlace de pago es del propio negocio: Impulza no cobra (decisión #6).",
  })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiZodBody(productSchema)
  @ApiZodResponse(201, productResponse, "Producto creado.")
  @ApiResponse({ status: 404, description: CATEGORY_NOT_FOUND })
  @ApiResponse({ status: 422, description: "Máximo de productos alcanzado, o imagen sin texto alternativo." })
  createProduct(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(productSchema)) body: ProductInput,
  ) {
    return this.catalogSetupService.createProduct(organizationId, user.id, siteId, body);
  }

  @Patch("products/:productId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Editar un producto", description: "Requiere `catalog.manage`. `null` borra un campo opcional (p. ej. `stock: null` quita el control de stock)." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("productId", "Producto a editar.")
  @ApiZodBody(updateProductSchema)
  @ApiZodResponse(200, productResponse, "Producto actualizado.")
  @ApiResponse({ status: 404, description: PRODUCT_NOT_FOUND })
  @ApiResponse({ status: 422, description: "Imagen sin texto alternativo." })
  updateProduct(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("productId") productId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.catalogSetupService.updateProduct(organizationId, user.id, siteId, productId, body);
  }

  @Delete("products/:productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Borrar un producto", description: "Requiere `catalog.manage`. Los pedidos existentes se conservan." })
  @ApiUuidParam("siteId", "Sitio de la organización.")
  @ApiUuidParam("productId", "Producto a borrar.")
  @ApiResponse({ status: 204, description: "Producto borrado." })
  @ApiResponse({ status: 404, description: PRODUCT_NOT_FOUND })
  async deleteProduct(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("productId") productId: string,
    @CurrentUser() user: User,
  ) {
    await this.catalogSetupService.deleteProduct(organizationId, user.id, siteId, productId);
  }
}
