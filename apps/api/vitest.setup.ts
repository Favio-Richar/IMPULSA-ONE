import http from "node:http";
import path from "node:path";
import supertest from "supertest";

// vitest no carga .env por sí solo (a diferencia de tsx --env-file usado en dev/start) —
// se carga explícitamente para que packages/config pueda validar el entorno en los tests.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));
} catch {
  // sin .env local — se asume que las variables ya están en el entorno (p. ej. CI).
}

// Conexiones reutilizables para supertest. superagent crea cada petición con `agent: false` (sin
// pool): una conexión TCP nueva por petición. Con cientos de pruebas e2e, Windows acumulaba miles de
// sockets en `TIME_WAIT` y algunas peticiones se colgaban hasta el timeout de 5 s, una prueba
// distinta en cada corrida. Junto con `listenForTests` (un solo servidor por archivo), cada archivo
// reutiliza unas pocas conexiones keep-alive.
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const { Test } = supertest as unknown as { Test: { prototype: { _agent: unknown; request: () => unknown } } };
const originalRequest = Test.prototype.request;
Test.prototype.request = function (this: { _agent: unknown }) {
  if (this._agent === false) {
    this._agent = keepAliveAgent;
  }
  return originalRequest.call(this);
};
