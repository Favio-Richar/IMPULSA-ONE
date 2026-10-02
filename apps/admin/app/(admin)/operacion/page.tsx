"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";

type Tab = "salud" | "colas" | "flags";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function AdminOperacionPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("salud");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operación Técnica de la Plataforma"
        description="Supervisión en vivo de servicios de infraestructura, colas en segundo plano BullMQ y feature flags."
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setTab("salud")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            tab === "salud"
              ? "bg-foreground text-background"
              : "text-foreground hover:bg-surface text-muted-foreground",
          )}
        >
          <Activity className="size-4" aria-hidden="true" />
          Estado de Infraestructura
        </button>
        <button
          type="button"
          onClick={() => setTab("colas")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            tab === "colas"
              ? "bg-foreground text-background"
              : "text-foreground hover:bg-surface text-muted-foreground",
          )}
        >
          <Layers className="size-4" aria-hidden="true" />
          Colas BullMQ (13)
        </button>
        <button
          type="button"
          onClick={() => setTab("flags")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            tab === "flags"
              ? "bg-foreground text-background"
              : "text-foreground hover:bg-surface text-muted-foreground",
          )}
        >
          <Zap className="size-4" aria-hidden="true" />
          Feature Flags
        </button>
      </div>

      {tab === "salud" && <HealthSection />}
      {tab === "colas" && <QueuesSection />}
      {tab === "flags" && <FeatureFlagsSection />}
    </div>
  );
}

function HealthSection(): React.JSX.Element {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminApi.health(),
    refetchInterval: 20000,
  });

  if (isLoading) return <LoadingState label="Inspeccionando estado técnico..." />;
  if (isError || !data) return <ErrorState description="No se pudo inspeccionar el estado técnico de la plataforma." onRetry={() => refetch()} />;

  const isHealthy = data.status === "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-white",
              isHealthy ? "bg-emerald-600" : data.status === "degraded" ? "bg-amber-600" : "bg-rose-600",
            )}
          >
            {isHealthy ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
          </div>
          <div>
            <h2 className="text-lg font-semibold capitalize">
              Plataforma {data.status === "ok" ? "Operativa" : data.status === "degraded" ? "Degradada" : "Con Errores"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Node {data.process.nodeVersion} · Uptime: {formatUptime(data.process.uptimeSeconds)}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* PostgreSQL */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="size-4" /> PostgreSQL
              </CardTitle>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  data.database.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
                )}
              >
                {data.database.status.toUpperCase()} ({data.database.latencyMs}ms)
              </span>
            </div>
            <CardDescription>Base de datos relacional principal</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between"><span>Usuarios:</span> <span className="font-semibold text-foreground">{data.database.counts.users}</span></div>
            <div className="flex justify-between"><span>Organizaciones:</span> <span className="font-semibold text-foreground">{data.database.counts.organizations}</span></div>
            <div className="flex justify-between"><span>Sitios:</span> <span className="font-semibold text-foreground">{data.database.counts.sites}</span></div>
            <div className="flex justify-between"><span>Reservas:</span> <span className="font-semibold text-foreground">{data.database.counts.bookings}</span></div>
            <div className="flex justify-between"><span>Pedidos:</span> <span className="font-semibold text-foreground">{data.database.counts.orders}</span></div>
          </CardContent>
        </Card>

        {/* Redis */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="size-4" /> Redis
              </CardTitle>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  data.redis.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
                )}
              >
                {data.redis.status.toUpperCase()} ({data.redis.latencyMs}ms)
              </span>
            </div>
            <CardDescription>Caché y transporte de colas BullMQ</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between"><span>Memoria usada:</span> <span className="font-semibold text-foreground">{formatBytes(data.redis.memoryUsedBytes)}</span></div>
            <div className="flex justify-between"><span>Clientes conectados:</span> <span className="font-semibold text-foreground">{data.redis.connectedClients ?? 1}</span></div>
            <div className="flex justify-between"><span>Latencia de ping:</span> <span className="font-semibold text-foreground">{data.redis.latencyMs} ms</span></div>
          </CardContent>
        </Card>

        {/* Worker */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="size-4" /> Worker HTTP (:4100)
              </CardTitle>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  data.worker.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
                )}
              >
                {data.worker.status.toUpperCase()}
              </span>
            </div>
            <CardDescription>Servicio de tareas en segundo plano</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between"><span>Estado:</span> <span className="font-semibold text-foreground">{data.worker.status === "ok" ? "En ejecución" : "No disponible"}</span></div>
            <div className="flex justify-between"><span>Latencia HTTP:</span> <span className="font-semibold text-foreground">{data.worker.latencyMs ? `${data.worker.latencyMs} ms` : "N/A"}</span></div>
            {data.worker.error && <p className="text-rose-600 truncate">{data.worker.error}</p>}
          </CardContent>
        </Card>

        {/* Almacenamiento */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Almacenamiento</CardTitle>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                {data.storage.status === "configured" ? "Activo" : "No config"}
              </span>
            </div>
            <CardDescription>S3 / Cloudflare R2 / MinIO</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between"><span>Proveedor:</span> <span className="font-semibold text-foreground">{data.storage.provider}</span></div>
            <div className="flex justify-between"><span>Bucket:</span> <span className="font-semibold text-foreground">{data.storage.bucket ?? "Local dev"}</span></div>
          </CardContent>
        </Card>

        {/* Pasarelas de Pago */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pasarelas de Cobro</CardTitle>
            <CardDescription>Webpay Oneclick y Mercado Pago</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Webpay Oneclick:</span>
              <span className="font-semibold text-foreground capitalize">{data.gateways.webpay.mode}</span>
            </div>
            <div className="flex justify-between">
              <span>Mercado Pago:</span>
              <span className="font-semibold text-foreground capitalize">{data.gateways.mercadoPago.mode}</span>
            </div>
          </CardContent>
        </Card>

        {/* Memoria de Proceso API */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Memoria API (Node)</CardTitle>
            <CardDescription>Consumo en tiempo real</CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            <div className="flex justify-between"><span>Heap Usado:</span> <span className="font-semibold text-foreground">{formatBytes(data.process.memory.heapUsedBytes)}</span></div>
            <div className="flex justify-between"><span>Heap Total:</span> <span className="font-semibold text-foreground">{formatBytes(data.process.memory.heapTotalBytes)}</span></div>
            <div className="flex justify-between"><span>RSS:</span> <span className="font-semibold text-foreground">{formatBytes(data.process.memory.rssBytes)}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QueuesSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "queues"],
    queryFn: () => adminApi.queues(),
    refetchInterval: 10000,
  });

  const pauseMutation = useMutation({
    mutationFn: (name: string) => adminApi.pauseQueue(name),
    onSuccess: (res) => {
      setFeedback(res.message ?? "Cola pausada.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (name: string) => adminApi.resumeQueue(name),
    onSuccess: (res) => {
      setFeedback(res.message ?? "Cola reanudada.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (name: string) => adminApi.retryFailedJobs(name),
    onSuccess: (res) => {
      setFeedback(res.message ?? "Trabajos fallidos reenviados.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });

  const cleanMutation = useMutation({
    mutationFn: (name: string) => adminApi.cleanQueue(name),
    onSuccess: (res) => {
      setFeedback(res.message ?? "Cola purgada.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });

  if (isLoading) return <LoadingState label="Cargando métricas de colas..." />;
  if (isError || !data) return <ErrorState description="No se pudieron consultar las colas BullMQ." onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Control y métricas de las 13 colas de procesamiento asíncrono.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {feedback && (
        <div className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-semibold underline">
            Cerrar
          </button>
        </div>
      )}

      <div className="rounded-md border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cola</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">En espera</TableHead>
              <TableHead className="text-right">Activos</TableHead>
              <TableHead className="text-right">Completados</TableHead>
              <TableHead className="text-right">Fallidos</TableHead>
              <TableHead className="text-right">Demorados</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.queues.map((q) => (
              <TableRow key={q.name}>
                <TableCell>
                  <div className="font-medium text-sm">{q.displayName}</div>
                  <div className="text-xs font-mono text-muted-foreground">{q.name}</div>
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      q.paused ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
                    )}
                  >
                    {q.paused ? "Pausada" : "Activa"}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{q.waiting}</TableCell>
                <TableCell className="text-right font-mono text-xs">{q.active}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{q.completed}</TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold text-rose-600">
                  {q.failed}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{q.delayed}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {q.paused ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => resumeMutation.mutate(q.name)}
                        disabled={resumeMutation.isPending}
                        title="Reanudar cola"
                      >
                        <Play className="size-3" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => pauseMutation.mutate(q.name)}
                        disabled={pauseMutation.isPending}
                        title="Pausar cola"
                      >
                        <Pause className="size-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => retryMutation.mutate(q.name)}
                      disabled={retryMutation.isPending || q.failed === 0}
                      title="Reintentar fallidos"
                    >
                      <RotateCcw className="size-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => cleanMutation.mutate(q.name)}
                      disabled={cleanMutation.isPending}
                      title="Purgar completados y fallidos"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FeatureFlagsSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "featureFlags"],
    queryFn: () => adminApi.featureFlags(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminApi.updateFeatureFlag(key, { enabled }),
    onSuccess: (updated) => {
      setFeedback(`Bandera "${updated.name}" actualizada a: ${updated.enabled ? "ACTIVADA" : "DESACTIVADA"}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "featureFlags"] });
    },
  });

  if (isLoading) return <LoadingState label="Cargando banderas de funcionalidad..." />;
  if (isError || !data) return <ErrorState description="No se pudieron cargar las feature flags." />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Conmutadores globales de funcionalidad. Cada cambio invalida la caché en Redis y surte efecto de inmediato.
      </p>

      {feedback && (
        <div className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-semibold underline">
            Cerrar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.items.map((flag) => (
          <Card key={flag.key} className={cn(!flag.enabled && "opacity-80")}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{flag.name}</CardTitle>
                <button
                  type="button"
                  onClick={() => toggleMutation.mutate({ key: flag.key, enabled: !flag.enabled })}
                  disabled={toggleMutation.isPending}
                  className="flex items-center gap-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring rounded"
                  aria-label={`${flag.enabled ? "Desactivar" : "Activar"} ${flag.name}`}
                >
                  {flag.enabled ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <ToggleRight className="size-6" /> Activada
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400">
                      <ToggleLeft className="size-6" /> Desactivada
                    </span>
                  )}
                </button>
              </div>
              <div className="font-mono text-xs text-muted-foreground">{flag.key}</div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <p>{flag.description}</p>
              {flag.rules && (
                <div className="mt-2 rounded bg-surface p-2 font-mono text-[10px]">
                  Reglas: {JSON.stringify(flag.rules)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
