import { Star } from "lucide-react";
import type { TestimonialsBlockConfig } from "@impulza/validation";
import { SiteImage } from "../ui/site-image.js";

function Rating({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5" role="img" aria-label={`${value} de 5 estrellas`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`h-4 w-4 ${
            index < value
              ? "fill-[var(--site-color-primary)] text-[var(--site-color-primary)]"
              : "text-[var(--site-color-border)]"
          }`}
        />
      ))}
    </div>
  );
}

export function TestimonialsBlock({ config }: { config: TestimonialsBlockConfig }) {
  return (
    <div>
      {config.title ? (
        <h2 className="mb-4 text-lg font-semibold text-[var(--site-color-foreground)]">{config.title}</h2>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {config.items.map((item, index) => (
          <figure
            key={index}
            className="flex flex-col gap-3 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)]"
          >
            {item.rating ? <Rating value={item.rating} /> : null}
            <blockquote className="m-0 text-sm text-[var(--site-color-foreground)]">
              “{item.quote}”
            </blockquote>
            <figcaption className="flex items-center gap-3">
              {item.avatar ? (
                <SiteImage image={item.avatar} className="h-9 w-9 rounded-full object-cover" />
              ) : null}
              <div className="text-sm">
                <div className="font-medium text-[var(--site-color-foreground)]">{item.author}</div>
                {item.role ? (
                  <div className="text-[var(--site-color-muted-foreground)]">{item.role}</div>
                ) : null}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
