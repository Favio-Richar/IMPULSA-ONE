import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SequencesController } from "./sequences.controller.js";
import { SequencesService } from "./sequences.service.js";

// Secuencias de correo (F7.5, ADR-020). La inscripción y el envío viven en el worker; acá, la
// configuración. `AuthModule` aporta el adaptador de correo (envío de prueba).
@Module({
  imports: [AuthModule],
  controllers: [SequencesController],
  providers: [SequencesService],
})
export class SequencesModule {}
