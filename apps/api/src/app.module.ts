import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { PlatformBrandingModule } from "./modules/platform-branding/platform-branding.module.js";
import { AgencyModule } from "./modules/agency/agency.module.js";
import { BrandProfileModule } from "./modules/brand-profile/brand-profile.module.js";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module.js";
import { PrismaModule } from "./database/prisma.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";
import { PlansModule } from "./modules/plans/plans.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { BlocksModule } from "./modules/blocks/blocks.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ContactsModule } from "./modules/contacts/contacts.module.js";
import { FormsModule } from "./modules/forms/forms.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { OrganizationsModule } from "./modules/organizations/organizations.module.js";
import { PagesModule } from "./modules/pages/pages.module.js";
import { PublicAnalyticsModule } from "./modules/public-analytics/public-analytics.module.js";
import { PublicFormsModule } from "./modules/public-forms/public-forms.module.js";
import { PublicLinksModule } from "./modules/public-links/public-links.module.js";
import { PublicSitesModule } from "./modules/public-sites/public-sites.module.js";
import { QrCodesModule } from "./modules/qr-codes/qr-codes.module.js";
import { ShortLinksModule } from "./modules/short-links/short-links.module.js";
import { SitesModule } from "./modules/sites/sites.module.js";
import { SupportModule } from "./modules/support/support.module.js";
import { ThemesModule } from "./modules/themes/themes.module.js";
import { TemplatesModule } from "./modules/templates/templates.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { MediaModule } from "./modules/media/media.module.js";
import { DomainsModule } from "./modules/domains/domains.module.js";
import { BookingsModule } from "./modules/bookings/bookings.module.js";
import { CampaignsModule } from "./modules/campaigns/campaigns.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { AbTestsModule } from "./modules/ab-tests/ab-tests.module.js";
import { SmartCtaModule } from "./modules/smart-cta/smart-cta.module.js";
import { AutomationsModule } from "./modules/automations/automations.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { PaymentAccountsModule } from "./modules/payment-accounts/payment-accounts.module.js";
import { WebhooksModule } from "./modules/webhooks/webhooks.module.js";
import { NewsletterModule } from "./modules/newsletter/newsletter.module.js";
import { SequencesModule } from "./modules/sequences/sequences.module.js";
import { FunnelsModule } from "./modules/funnels/funnels.module.js";
import { PageCampaignsModule } from "./modules/page-campaigns/page-campaigns.module.js";

// Módulo raíz — los módulos de dominio (sites, forms, ...) se agregan a partir de Fase 2, uno
// por historia del backlog. Ver docs/BACKLOG_FASE_0_1.md.
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    FeatureFlagsModule,
    StorageModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    ThemesModule,
    TemplatesModule,
    SitesModule,
    PagesModule,
    BlocksModule,
    ContactsModule,
    FormsModule,
    AnalyticsModule,
    PlansModule,
    ShortLinksModule,
    QrCodesModule,
    PublicSitesModule,
    PublicFormsModule,
    PublicAnalyticsModule,
    PublicLinksModule,
    SupportModule,
    MediaModule,
    DomainsModule,
    BookingsModule,
    CatalogModule,
    CampaignsModule,
    AiModule,
    AbTestsModule,
    SmartCtaModule,
    AutomationsModule,
    WebhooksModule,
    NewsletterModule,
    SequencesModule,
    FunnelsModule,
    PageCampaignsModule,
    BillingModule,
    PaymentAccountsModule,
    AdminModule,
    PlatformBrandingModule,
    BrandProfileModule,
    AgencyModule,
    HealthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
