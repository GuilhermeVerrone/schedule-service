import type { ReactNode } from "react";

// Cabeçalho das telas do painel (DESIGN.md > Layout: h1 + lead, depois head-gap). A ação
// principal fica ao lado do título no desktop e embaixo dele no celular.
export function PageHead({ title, lead, action, before }: { title: ReactNode; lead: string; action?: ReactNode; before?: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {before}
        <h1 className="max-w-[22ch] text-headline break-words text-ink">{title}</h1>
        <p className="mt-4 max-w-[60ch] text-lead text-ink-2">{lead}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-page px-gutter pt-[clamp(2rem,1rem+3vw,4rem)] pb-section">{children}</div>;
}
