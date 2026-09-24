-- F3.6: pipeline de analítica.
-- Los agregados de enlaces cortos y QR son de nivel organización (sin sitio), así que site_id
-- pasa a admitir nulos. El índice único se recrea con NULLS NOT DISTINCT (Postgres 15+) para que
-- el upsert "INSERT ... ON CONFLICT" del pipeline sume sobre la fila existente también cuando
-- site_id es nulo, en vez de insertar una fila nueva por cada evento.
-- No destructiva: solo relaja una restricción y reemplaza un índice por uno equivalente más
-- estricto; no borra ni reescribe filas.

ALTER TABLE "analytics_aggregates" ALTER COLUMN "site_id" DROP NOT NULL;

DROP INDEX "analytics_aggregates_organization_id_site_id_period_metric_key";
CREATE UNIQUE INDEX "analytics_aggregates_organization_id_site_id_period_metric_key"
  ON "analytics_aggregates"("organization_id", "site_id", "period", "metric") NULLS NOT DISTINCT;

CREATE INDEX "analytics_aggregates_organization_id_period_idx"
  ON "analytics_aggregates"("organization_id", "period");
