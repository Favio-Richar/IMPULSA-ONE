import { ImageResponse } from "next/og";

// Imagen Open Graph genérica (F11, "SEO avanzado", decisión del propietario 2026-10-13): solo se
// usa como RESPALDO cuando una página -- de un sitio publicado o de este mismo sitio comercial --
// no tiene una imagen propia (`seo.openGraph.image`, F2.8). Nunca pisa una imagen que el usuario
// sí eligió: eso lo decide quien llama a `seoToMetadata` (`lib/seo-metadata.ts`), acá solo se
// dibuja la imagen cuando se pide.
const WIDTH = 1200;
const HEIGHT = 630;
const BRAND_TEAL = "#0f6f6b";
const MAX_TITLE = 160;
const MAX_SUBTITLE = 120;

function clamp(value: string | null, max: number): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const title = clamp(searchParams.get("title"), MAX_TITLE) || "Impulza One";
  const subtitle = clamp(searchParams.get("subtitle"), MAX_SUBTITLE);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "72px",
          backgroundColor: "#0a2e2c",
          backgroundImage: `linear-gradient(135deg, ${BRAND_TEAL} 0%, #0a2e2c 100%)`,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#ffffff", opacity: 0.85, marginBottom: 24 }}>Impulza One</div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#ffffff", lineHeight: 1.15, maxWidth: 1000 }}>{title}</div>
        {subtitle ? <div style={{ display: "flex", fontSize: 32, color: "#d7ece9", marginTop: 20, maxWidth: 1000 }}>{subtitle}</div> : null}
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
