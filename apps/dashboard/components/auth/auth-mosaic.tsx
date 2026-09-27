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

/**
 * Panel visual de las pantallas de acceso (login/registro/verificación): mosaico con vistas
 * previas reales del catálogo de plantillas (nunca fotos de personas inventadas), sobre el color
 * de marca oficial de Impulza One (verde azulado #0f6f6b, decidido por el propietario del
 * producto — ver README "Identidad de marca"). Mismo patrón visual que el hero del sitio
 * comercial (apps/web), adaptado a este panel oscuro.
 */
export function AuthMosaic({ templates }: { templates: TemplateResponse[] }) {
  const hasTemplates = templates.length > 0;
  const tiles = hasTemplates ? Array.from({ length: 9 }, (_, index) => templates[index % templates.length]!) : [];

  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(255,255,255,0.14)_1px,_transparent_1px)] [background-size:22px_22px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-10 h-80 w-80 rounded-full bg-black/20 blur-3xl"
      />

      <div className="relative flex items-center gap-2 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/15 text-xs font-bold">IO</span>
        <span className="text-base font-semibold">Impulza One</span>
      </div>

      {hasTemplates ? (
        <div className="relative mx-auto grid max-w-md grid-cols-3 gap-4 [mask-image:radial-gradient(ellipse_75%_75%_at_50%_50%,#000_55%,transparent_100%)]">
          {tiles.map((template, index) => {
            const tokens = (template.theme.tokens ?? {}) as ThemeTokensPreview;
            const palette = tokens.palette ?? {};
            const background = palette.background ?? "#e6f5f3";
            const primary = palette.primary ?? "#0f6f6b";
            const primaryForeground = palette.primaryForeground ?? "#ffffff";
            const avatarSeed = encodeURIComponent(`${template.code}-auth-${index}`);
            const avatarSrc = `https://api.dicebear.com/9.x/notionists/svg?seed=${avatarSeed}&backgroundColor=transparent`;
            const initials = template.name.slice(0, 2).toLocaleUpperCase("es");

            return (
              <div
                key={`${template.code}-${index}`}
                className={`flex aspect-[3/5] flex-col items-center justify-center gap-2 rounded-2xl border border-white/30 p-3 shadow-lg ${ROTATIONS[index % ROTATIONS.length]}`}
                style={{ background }}
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
      ) : (
        <div />
      )}

      <p className="relative max-w-sm text-lg font-medium text-white">
        Tu portal biográfico, tu mini-CRM y tu analítica — en un solo enlace.
      </p>
    </div>
  );
}
