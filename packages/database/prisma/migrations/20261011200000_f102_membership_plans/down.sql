-- Reversa de F10.2. ATENCION: se pierden los planes y el historial de compras de membresia (los pagos ya hechos en Mercado Pago NO se
-- deshacen), y los miembros que entraron pagando quedan como miembros invitados (conservan acceso). Revisar antes de revertir.
DROP TABLE "membership_purchases";
DROP TABLE "membership_plans";
ALTER TABLE "site_members" DROP COLUMN "source";
DROP TYPE "MembershipPurchaseStatus";
DROP TYPE "MembershipPlanStatus";
DROP TYPE "MembershipPeriod";
DROP TYPE "SiteMemberSource";
