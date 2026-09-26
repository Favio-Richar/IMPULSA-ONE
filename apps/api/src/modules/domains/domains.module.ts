import { Module } from "@nestjs/common";
import { DOMAIN_DNS_RESOLVER, NodeDomainDnsResolver } from "./dns-resolver.js";
import { DomainsController } from "./domains.controller.js";
import { DomainsService } from "./domains.service.js";
import { PublicDomainsController } from "./public-domains.controller.js";

@Module({
  controllers: [DomainsController, PublicDomainsController],
  providers: [DomainsService, { provide: DOMAIN_DNS_RESOLVER, useClass: NodeDomainDnsResolver }],
})
export class DomainsModule {}
