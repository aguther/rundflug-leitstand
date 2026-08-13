import { Children, type ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode[];
  actions?: ReactNode;
  level?: 1 | 2;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  level = 1,
}: Readonly<PageHeaderProps>) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="ds-page-header">
      <div>
        {breadcrumb && breadcrumb.length > 0 ? (
          <div className="ds-page-header-eyebrow">
            {Children.map(breadcrumb, (crumb, index) => (
              <span aria-current={index === breadcrumb.length - 1 ? "page" : undefined}>
                {crumb}
                {index < breadcrumb.length - 1 ? " › " : null}
              </span>
            ))}
          </div>
        ) : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ds-page-header-actions">{actions}</div> : null}
    </div>
  );
}
