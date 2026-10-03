-- F9.3: el plan de agencia incluye cupo de clientes. Valor PROVISORIO (decisión #4 del propietario): se ajusta
-- desde la superadministración sin desplegar. Solo se agrega si el plan no lo trae (nunca pisa una edición).
UPDATE "plans"
SET "limits" = "limits" || '{"clients": 25}'::jsonb
WHERE "code" = 'agencia' AND NOT ("limits" ? 'clients');
