import { Module } from "@nestjs/common";
import { CoursesController } from "./courses.controller.js";
import { CoursesService } from "./courses.service.js";
import { PublicCoursesController } from "./public-courses.controller.js";
import { PublicCoursesService } from "./public-courses.service.js";

// Cursos, módulos, lecciones y progreso por miembro (F10.3, ADR-029). La sesión del miembro y su acceso pagado salen de las
// tablas de F10.1/F10.2; el módulo no depende de ningún otro servicio.
@Module({
  controllers: [PublicCoursesController, CoursesController],
  providers: [CoursesService, PublicCoursesService],
})
export class CoursesModule {}
