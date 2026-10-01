#!/usr/bin/env bash
# Preparación del entorno para sesiones de Claude Code en la nube (hook SessionStart de
# `.claude/settings.json`). Solo actúa cuando CLAUDE_CODE_REMOTE=true: en la máquina de Favio no hace
# nada. Es de mejor esfuerzo: si algo no se puede (sin Docker, sin apt, sin red), lo dice y sigue —
# nunca hace fallar el arranque de la sesión. Lo que logró y lo que no queda en
# `.claude/cloud-setup.log`, y la sesión debe leerlo antes de correr pruebas (docs/CONTINUIDAD.md).
set -u

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/.claude/cloud-setup.log"
mkdir -p "$ROOT/.claude"
: > "$LOG"
log() { printf '%s\n' "$*" | tee -a "$LOG"; }
step() { log ""; log "== $*"; }

cd "$ROOT" || exit 0

# Puertos del proyecto (README, "Entorno local"): los mismos de .env.example.
PG_PORT=55433
REDIS_PORT=56380
PG_USER=impulza
PG_PASSWORD=impulza_local_dev

step "Variables de entorno"
if [ ! -f .env ]; then
  cp .env.example .env && log "creado .env desde .env.example (valores de desarrollo, sin secretos reales)"
else
  log ".env ya existe: se respeta"
fi
[ -f apps/dashboard/.env.local ] || { cp .env.example apps/dashboard/.env.local && log "creado apps/dashboard/.env.local"; }
[ -f apps/admin/.env.local ] || { echo "NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1" > apps/admin/.env.local && log "creado apps/admin/.env.local"; }
[ -f apps/web/.env.local ] || { cp .env.example apps/web/.env.local && log "creado apps/web/.env.local"; }

step "Dependencias (pnpm vía Corepack)"
if command -v corepack >/dev/null 2>&1; then
  corepack enable >>"$LOG" 2>&1 || true
fi
if command -v pnpm >/dev/null 2>&1; then
  if pnpm install --frozen-lockfile >>"$LOG" 2>&1; then log "pnpm install OK"; else log "AVISO: pnpm install falló (ver arriba)"; fi
else
  log "AVISO: pnpm no disponible (corepack enable falló). Probar: npx pnpm@12.4.1 install"
fi

step "Postgres y Redis"
db_ready() { command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p "$PG_PORT" >/dev/null 2>&1; }
redis_ready() { command -v redis-cli >/dev/null 2>&1 && redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; }

if ! db_ready && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Docker disponible: docker compose up -d postgres redis"
  docker compose up -d postgres redis >>"$LOG" 2>&1 || log "AVISO: docker compose falló"
  sleep 5
fi

if ! db_ready && command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  log "Sin Docker: instalando postgresql y redis-server con apt (puede tardar)"
  export DEBIAN_FRONTEND=noninteractive
  { apt-get update -qq && apt-get install -y -qq postgresql redis-server; } >>"$LOG" 2>&1 || log "AVISO: apt-get no pudo instalar (¿sin red?)"
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$PG_BIN" ]; then
    PGDATA=/var/lib/postgresql/impulza-data
    if [ ! -d "$PGDATA" ]; then
      install -d -o postgres -g postgres "$PGDATA"
      su postgres -c "$PG_BIN/initdb -D $PGDATA -U postgres --auth=trust" >>"$LOG" 2>&1
    fi
    su postgres -c "$PG_BIN/pg_ctl -D $PGDATA -o '-p $PG_PORT -k /tmp' -l /tmp/impulza-postgres.log start" >>"$LOG" 2>&1 || true
    sleep 3
    # SQL en un archivo: sin comillas anidadas dentro de `su -c`.
    SQL_FILE="$(mktemp /tmp/impulza-setup-XXXX.sql)"
    cat > "$SQL_FILE" <<SQL
DO \$body\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PG_USER') THEN
    CREATE ROLE $PG_USER LOGIN SUPERUSER PASSWORD '$PG_PASSWORD';
  END IF;
END
\$body\$;
SQL
    chmod 644 "$SQL_FILE"
    su postgres -c "psql -h /tmp -p $PG_PORT -f $SQL_FILE" >>"$LOG" 2>&1
    if ! su postgres -c "psql -h /tmp -p $PG_PORT -tAc 'SELECT 1 FROM pg_database WHERE datname = ''impulza'''" 2>/dev/null | grep -q 1; then
      su postgres -c "createdb -h /tmp -p $PG_PORT -O $PG_USER impulza" >>"$LOG" 2>&1
    fi
    rm -f "$SQL_FILE"
  fi
  if command -v redis-server >/dev/null 2>&1 && ! redis_ready; then
    redis-server --port "$REDIS_PORT" --daemonize yes >>"$LOG" 2>&1 || true
  fi
fi

if db_ready; then log "Postgres OK en $PG_PORT"; else log "AVISO: Postgres NO disponible: las pruebas e2e de API/worker y openapi:generate no correrán"; fi
if redis_ready || (command -v docker >/dev/null 2>&1 && docker compose ps redis 2>/dev/null | grep -q running); then log "Redis OK en $REDIS_PORT"; else log "AVISO: Redis NO disponible"; fi

if db_ready && command -v pnpm >/dev/null 2>&1; then
  step "Base de datos: migraciones, seed y base de pruebas"
  # La CLI de Prisma busca su .env en packages/database, que en la nube no existe: se exporta el de
  # la raíz solo para estos comandos (en una subshell, para no contaminar el `next build` posterior
  # con NODE_ENV=development).
  db_run() { (set -a; . ./.env; set +a; pnpm --filter @impulza/database run "$1") >>"$LOG" 2>&1; }
  db_run db:generate || log "AVISO: prisma generate falló"
  db_run db:migrate:deploy && log "migraciones OK" || log "AVISO: migrate deploy falló"
  db_run db:seed && log "seed OK" || log "AVISO: seed falló"
  db_run db:test:prepare && log "base de pruebas OK" || log "AVISO: db:test:prepare falló"
fi

step "Listo"
log "Resumen en .claude/cloud-setup.log. Siguiente: leer docs/CONTINUIDAD.md."
exit 0
