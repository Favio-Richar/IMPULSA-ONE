import type { TemplateResponse } from "@impulza/contracts";
import { TemplateAvatar } from "./template-avatar";

interface ThemeTokensPreview {
  palette?: {
    background?: string;
    primary?: string;
    primaryForeground?: string;
  };
}

const ROTATIONS = ["-rotate-3", "rotate-2", "-rotate-1", "rotate-3", "rotate-1", "-rotate-2", "rotate-2", "-rotate-3", "rotate-1"];

// Mosaico de vistas previas reales de plantillas del catalogo (nunca fotos de personas
// inventadas): repite el catalogo hasta llenar la grilla y reutiliza el mismo criterio de avatar
// de ejemplo ya documentado en TemplateMockup, solo que en formato tarjeta angosta para el collage
// visual del hero — inspirado en el estilo de collage de Linktree/Beacons, con contenido propio.
export function TemplateMosaic({ templates }: { templates: TemplateResponse[] }) {
  if (templates.length === 0) return null;
  const tiles = Array.from({ length: 9 }, (_, index) => templates[index % templates.length]!);

  return (
    <div className="grid grid-cols-3 gap-4 [mask-image:radial-gradient(ellipse_75%_75%_at_50%_50%,#000_55%,transparent_100%)]">
      {tiles.map((template, index) => {
        const tokens = (template.theme.tokens ?? {}) as ThemeTokensPreview;
        const palette = tokens.palette ?? {};
        const background = palette.background ?? "#eef2ff";
        const primary = palette.primary ?? "#4338ca";
        const primaryForeground = palette.primaryForeground ?? "#ffffff";
        const avatarSeed = encodeURIComponent(`${template.code}-${index}`);
        const avatarSrc = `https://api.dicebear.com/9.x/notionists/svg?seed=${avatarSeed}&backgroundColor=transparent`;
        const initials = template.name.slice(0, 2).toLocaleUpperCase("es");

        return (
          <div
            key={`${template.code}-${index}`}
            className={`animate-marketing-float flex aspect-[3/5] flex-col items-center justify-center gap-2 rounded-2xl border border-white/40 p-3 shadow-lg ${ROTATIONS[index % ROTATIONS.length]}`}
            style={{ background, animationDelay: `${(index % 5) * -1.2}s` }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
              style={{ backgroundColor: primary, color: primaryForeground }}
            >
              <TemplateAvatar src={avatarSrc} fallbackLabel={initials} />
            </span>
            <span className="h-1.5 w-8 rounded-full" style={{ backgroundColor: primary }} />
            <span className="h-1.5 w-6 rounded-full opacity-60" style={{ backgroundColor: primary }} />
          </div>
        );
      })}
    </div>
  );
}
