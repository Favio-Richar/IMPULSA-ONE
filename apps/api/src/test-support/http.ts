import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";

/**
 * Deja la app escuchando **una vez** en un puerto libre y devuelve su URL para supertest.
 *
 * Pasarle a supertest el servidor sin escuchar (`app.getHttpServer()`) hace que abra un servidor
 * nuevo en un puerto efímero **por cada petición**: con cientos de pruebas, Windows acumulaba miles
 * de sockets en `TIME_WAIT` y algunas peticiones se colgaban hasta el timeout de 5 s (una prueba
 * distinta en cada corrida completa). Con un solo servidor, Node 24 reutiliza las conexiones
 * (keep-alive por defecto en el agente global).
 */
export async function listenForTests(app: INestApplication): Promise<string> {
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
