import { ActionNotificationStack, PageNotificationRegion } from "../../app/PageNotifications";
import { BrandLockup, BrandMark } from "../../design-system/BrandMark";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import "./login.css";

export type AccessPageVariant = "compact" | "form" | "reading";

export function AccessPageFrame({
  className = "",
  children,
  description,
  eyebrow,
  notifications = false,
  title,
  titleId,
  variant = "compact",
}: Readonly<{
  className?: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  notifications?: boolean;
  title: React.ReactNode;
  titleId: string;
  variant?: AccessPageVariant;
}>) {
  return (
    <main className={`access-page access-page--${variant} ${className}`.trim()}>
      <header className="access-page-topbar">
        <a className="app-brand" href="/">
          <BrandLockup />
        </a>
        <ThemeToggle />
      </header>
      {notifications ? (
        <PageNotificationRegion>
          <ActionNotificationStack />
        </PageNotificationRegion>
      ) : null}
      <section className="access-page-panel" aria-labelledby={titleId}>
        <div className="access-page-heading">
          <BrandMark />
          <div>
            {eyebrow ? <span className="access-page-eyebrow">{eyebrow}</span> : null}
            <h1 id={titleId}>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
