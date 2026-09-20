import type { PublicBlockResponse } from "@impulza/contracts";
import type { ThemeTokens } from "@impulza/validation";
import { RenderBlock } from "./blocks/registry";
import { Container } from "./ui/container";
import type { ButtonVariant } from "./ui/link-button";

function buttonVariantFor(buttonStyle: ThemeTokens["buttonStyle"]): ButtonVariant {
  return buttonStyle === "outline" ? "outline" : "primary";
}

/** Cada página publicada es, en el fondo, una lista ordenada de bloques (F2.4/F2.6) — esto es lo
 *  único que decide cómo se apilan: el resto de la apariencia vive en cada bloque y en el tema. */
export function PageBlocks({
  blocks,
  buttonStyle,
}: {
  blocks: PublicBlockResponse[];
  buttonStyle: ThemeTokens["buttonStyle"];
}) {
  const buttonVariant = buttonVariantFor(buttonStyle);

  return (
    <Container className="flex flex-col py-10" style={{ gap: "var(--site-gap)" }}>
      {blocks.map((block, index) => (
        <RenderBlock key={index} block={block} buttonVariant={buttonVariant} />
      ))}
    </Container>
  );
}
