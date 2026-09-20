import type { TextBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text";

const ALIGN_CLASSES: Record<TextBlockConfig["alignment"], string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function TextBlock({ config }: { config: TextBlockConfig }) {
  return <RichText html={config.html} className={ALIGN_CLASSES[config.alignment]} />;
}
