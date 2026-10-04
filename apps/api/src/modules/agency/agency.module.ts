import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { AGENCY_IMPORT_QUEUE, type AgencyImportJob } from "@impulza/agency";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { AgencyAccessService } from "./agency-access.service.js";
import { AgencyBillingService } from "./agency-billing.service.js";
import { AgencyDashboardService } from "./agency-dashboard.service.js";
import { AgencyImportController } from "./agency-import.controller.js";
import { AgencyImportService } from "./agency-import.service.js";
import { AGENCY_IMPORT_QUEUE_TOKEN } from "./agency.tokens.js";
import { AgencyDuplicateService } from "./agency-duplicate.service.js";
import { AgencyTransferService } from "./agency-transfer.service.js";
import { AgencyInvitationsController, AgencyLinkController } from "./agency-link.controller.js";
import { AgencyController } from "./agency.controller.js";
import { AgencyService } from "./agency.service.js";

// Global: `OrganizationsService` sincroniza el acceso delegado cuando cambia el equipo de una agencia, y no debe
// importar este módulo (y arrastrar sus controladores) en cada lugar donde se usa.
@Global()
@Module({
  // `AuthModule` aporta el adaptador de correo (invitaciones y avisos); `PublicSitesModule`, el aviso a apps/web al ocultar o mostrar un sitio.
  imports: [AuthModule, PublicSitesModule],
  controllers: [AgencyImportController, AgencyController, AgencyLinkController, AgencyInvitationsController],
  providers: [AgencyService, AgencyAccessService, AgencyDashboardService, AgencyBillingService, AgencyTransferService, AgencyDuplicateService, AgencyImportService,
    // Conexión propia de BullMQ (exige `maxRetriesPerRequest: null`), igual que las colas de medios y analítica.
    { provide: AGENCY_IMPORT_QUEUE_TOKEN, useFactory: () => new Queue<AgencyImportJob>(AGENCY_IMPORT_QUEUE, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } }) },
  ],
  exports: [AgencyService, AgencyAccessService],
})
export class AgencyModule implements OnApplicationShutdown {
  constructor(@Inject(AGENCY_IMPORT_QUEUE_TOKEN) private readonly importQueue: Queue<AgencyImportJob>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.importQueue.close();
  }
}
