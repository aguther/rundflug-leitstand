import type { ReactNode } from "react";

export function WorkspaceSection({
  title,
  description,
  actions,
  children,
  className = "",
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <section className={`event-workspace-section ${className}`.trim()}>
      <header className="event-workspace-section-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="event-workspace-section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
