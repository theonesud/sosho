import type { ReactNode } from "react";

interface ShowcaseSectionProps {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

export function ShowcaseSection({ id, title, description, children }: ShowcaseSectionProps) {
  return (
    <section id={id} className="showcase-section" aria-labelledby={`${id}-title`}>
      <header className="section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="muted">{description}</p>
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
