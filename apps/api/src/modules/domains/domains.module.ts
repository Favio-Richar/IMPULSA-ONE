import { Module } from "@nestjs/common";
import { DOMAIN_DNS_RESOLVER, NodeDomainDnsResolver } from "./dns-resolver.js";
import { DomainsController } from "./domains.controller.js";
import { DomainsService } from "./domains.service.js";
import { PublicDomainsController } from "./public-domains.controller.js";

@Module({
  controllers: [DomainsController, PublicDomainsController],
  providers: [DomainsService, { provide: DOMAIN_DNS_RESOLVER, useClass: NodeDomainDnsResolver }],
  // El dominio del portal de una agencia (F9.7d) usa el mismo resolvedor: una sola forma de verificar un dominio.
  exports: [DOMAIN_DNS_RESOLVER],
})
export class DomainsModule {}
