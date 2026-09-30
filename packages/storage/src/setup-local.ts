import path from "node:path";
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { parseStorageConfig } from "./config.js";

// Prepara el bucket de **desarrollo** en MinIO (`docker compose --profile storage up -d minio`):
//   pnpm --filter @impulza/storage run setup:local
// Crea el bucket, permite leer públicamente los objetos (así los ve la página pública, igual que el
// dominio público de R2) y restringe las subidas desde el navegador al origen del panel.
// En producción esto se configura una vez en el panel de Cloudflare R2 (ver ADR-006 §7 y el README).

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", "..", ".env"));
} catch {
  // sin .env: se usan las variables del entorno.
}

const config = parseStorageConfig(process.env);
if (!config) {
  console.error("Faltan las variables STORAGE_* en el .env (ver .env.example).");
  process.exit(1);
}

const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
});

const exists = await client.send(new HeadBucketCommand({ Bucket: config.bucket })).then(
  () => true,
  () => false,
);
if (!exists) {
  await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  console.log(`Bucket ${config.bucket} creado.`);
}

// Solo lectura pública de objetos; nunca listar el bucket ni escribir sin URL prefirmada.
await client.send(
  new PutBucketPolicyCommand({
    Bucket: config.bucket,
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${config.bucket}/*`] }],
    }),
  }),
);

const dashboardOrigin = process.env.APP_BASE_URL ?? "http://localhost:3100";
try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [{ AllowedOrigins: [dashboardOrigin], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 }],
      },
    }),
  );
} catch {
  // MinIO en modo local acepta CORS de cualquier origen y no implementa esta API en todas sus
  // versiones: no es un error para desarrollo. En R2 la regla se configura en el panel.
  console.log("CORS por bucket no disponible en este MinIO (usa el CORS global del servidor).");
}

console.log(`Listo: ${config.bucket} con lectura pública en ${config.publicBaseUrl}.`);

// Bucket privado de archivos en venta (F5.11b, ADR-015): **sin** política de lectura pública (lo
// único que lo lee es una URL prefirmada de pocos minutos) y con subida desde el panel.
if (config.privateBucket) {
  const privateExists = await client.send(new HeadBucketCommand({ Bucket: config.privateBucket })).then(
    () => true,
    () => false,
  );
  if (!privateExists) {
    await client.send(new CreateBucketCommand({ Bucket: config.privateBucket }));
    console.log(`Bucket privado ${config.privateBucket} creado.`);
  }
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: config.privateBucket,
        CORSConfiguration: {
          CORSRules: [{ AllowedOrigins: [dashboardOrigin], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type"], MaxAgeSeconds: 3600 }],
        },
      }),
    );
  } catch {
    console.log("CORS por bucket no disponible en este MinIO (usa el CORS global del servidor).");
  }
  console.log(`Listo: ${config.privateBucket} privado (sin lectura pública).`);
}
