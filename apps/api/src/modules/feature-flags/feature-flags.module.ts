import { Global, Module } from "@nestjs/common";
import { FeatureFlagGuard } from "./feature-flag.guard.js";
import { FeatureFlagsService } from "./feature-flags.service.js";

// Global: cualquier módulo de dominio puede apagarse con una bandera sin repetir el import.
@Global()
@Module({
  providers: [FeatureFlagsService, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
