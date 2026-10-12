-- Reversa de F10.3: se pierden los cursos, sus lecciones y el progreso de los miembros (los miembros y sus planes no se tocan).
DROP TABLE "lesson_progress";
DROP TABLE "course_plans";
DROP TABLE "lessons";
DROP TABLE "course_modules";
DROP TABLE "courses";
DROP TYPE "LessonKind";
DROP TYPE "CourseAccess";
DROP TYPE "CourseStatus";
