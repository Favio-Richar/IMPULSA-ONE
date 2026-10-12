-- F10.3 (ADR-029): cursos. Curso -> modulos -> lecciones, planes que dan acceso y progreso por miembro.
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "CourseAccess" AS ENUM ('OPEN', 'MEMBERS', 'PLAN');
CREATE TYPE "LessonKind" AS ENUM ('TEXT', 'VIDEO');

CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "cover_url" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "access" "CourseAccess" NOT NULL DEFAULT 'MEMBERS',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "courses_site_slug_key" ON "courses"("site_id", "slug");
CREATE INDEX "courses_organization_id_idx" ON "courses"("organization_id");
CREATE INDEX "courses_site_id_status_position_idx" ON "courses"("site_id", "status", "position");
ALTER TABLE "courses" ADD CONSTRAINT "courses_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "course_modules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "course_modules_course_id_position_idx" ON "course_modules"("course_id", "position");
CREATE INDEX "course_modules_organization_id_idx" ON "course_modules"("organization_id");
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "LessonKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "video" JSONB,
    "duration_minutes" INTEGER,
    "free_preview" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lessons_module_id_position_idx" ON "lessons"("module_id", "position");
CREATE INDEX "lessons_course_id_idx" ON "lessons"("course_id");
CREATE INDEX "lessons_organization_id_idx" ON "lessons"("organization_id");
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "course_plans" (
    "course_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    CONSTRAINT "course_plans_pkey" PRIMARY KEY ("course_id", "plan_id")
);
CREATE INDEX "course_plans_plan_id_idx" ON "course_plans"("plan_id");
ALTER TABLE "course_plans" ADD CONSTRAINT "course_plans_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_plans" ADD CONSTRAINT "course_plans_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lesson_progress_member_lesson_key" ON "lesson_progress"("member_id", "lesson_id");
CREATE INDEX "lesson_progress_course_id_member_id_idx" ON "lesson_progress"("course_id", "member_id");
CREATE INDEX "lesson_progress_organization_id_idx" ON "lesson_progress"("organization_id");
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "site_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
