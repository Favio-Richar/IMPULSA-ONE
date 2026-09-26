import type { PublicBlockResponse, PublicFormResponse } from "@impulza/contracts";
import type { ThemeTokens } from "@impulza/validation";
import type { CSSProperties } from "react";
import { PRIMARY_ACTION_ANCHOR, primaryActionOf } from "./lib/primary-action.js";
import { RenderBlock } from "./registry.js";
import { Container } from "./ui/container.js";
import type { ButtonVariant } from "./ui/link-button.js";
import { PrimaryActionBar } from "./ui/primary-action-bar.js";

function buttonVariantFor(buttonStyle: ThemeTokens["buttonStyle"]): ButtonVariant {
  return buttonStyle === "outline" ? "outline" : "primary";
}

/** Cada página publicada es, en el fondo, una lista ordenada de bloques (F2.4/F2.6) — esto es lo
 *  único que decide cómo se apilan: el resto de la apariencia vive en cada bloque y en el tema.
 *  Compartido entre el render público (apps/web, F2.7) y la vista previa del constructor
 *  (apps/dashboard, F2.9) para que ambos apilen los bloques exactamente igual.
 *
 *  `forms`/`siteSlug` son de F3.2 (bloque `contact_form` real): `apps/web` los pasa siempre (sitio
 *  público real, envío real); `apps/dashboard` los omite y pasa `mode="preview"` — el bloque
 *  muestra el formulario elegido sin enviar nada de verdad (ver `contact-form.tsx`). */
export function PageBlocks({
  blocks,
  buttonStyle,
  siteSlug,
  forms,
  mode = "public",
}: {
  blocks: PublicBlockResponse[];
  buttonStyle: ThemeTokens["buttonStyle"];
  siteSlug?: string;
  forms?: Record<string, PublicFormResponse>;
  mode?: "public" | "preview";
}) {
  const buttonVariant = buttonVariantFor(buttonStyle);
  // PP5: a lo sumo uno (la API ya lo garantiza); si llegara más de uno, manda el primero.
  const primaryBlock = blocks.find((block) => block.primary === true);
  const primaryAction = primaryBlock ? primaryActionOf(primaryBlock) : null;

  return (
    // `@container`: la barra fija del teléfono decide por el ancho de **este** contenedor, no de la
    // ventana — así la vista previa del constructor en modo teléfono se comporta como un teléfono.
    // Va acá y no en la raíz del sitio: `container-type` crea contención de layout, que convertiría
    // la raíz en el bloque contenedor del fondo `fixed` de PP3.
    <div className="@container">
      <Container className="flex flex-col py-10" style={{ gap: "var(--site-gap)" }}>
        {blocks.map((block, index) => {
          const isPrimary = block === primaryBlock;
          return (
            // `data-block-*` es lo único que necesita el rastreador de analítica del sitio público
            // (F3.6, `apps/web/components/analytics-tracker.tsx`) para atribuir un clic a su bloque
            // sin que cada bloque tenga que ser un componente de cliente ni conocer la analítica.
            // `position` y no un id: el contrato público no expone ids internos (F2.7).
            // `site-block-enter` + `--site-block-index`: entrada suave y escalonada (PP5,
            // `styles/site.css`), que no existe con "reducir movimiento".
            <div
              key={index}
              id={isPrimary ? PRIMARY_ACTION_ANCHOR : undefined}
              data-block-position={block.position}
              data-block-type={block.type}
              data-primary-action={isPrimary ? "" : undefined}
              className="site-block-enter scroll-mt-6"
              style={{ "--site-block-index": index } as CSSProperties}
            >
              <RenderBlock
                block={block}
                buttonVariant={buttonVariant}
                siteSlug={siteSlug}
                forms={forms}
                mode={mode}
              />
            </div>
          );
        })}
        {primaryBlock && primaryAction ? (
          <PrimaryActionBar
            action={primaryAction}
            position={primaryBlock.position}
            type={primaryBlock.type}
            targetId={PRIMARY_ACTION_ANCHOR}
          />
        ) : null}
      </Container>
    </div>
  );
}
