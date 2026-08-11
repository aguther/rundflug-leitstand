import { Component, createRef, type ReactNode } from "react";

export type AppErrorBoundaryScope = "application" | "route";

interface AppErrorBoundaryProps {
  children: ReactNode;
  reload?: () => void;
  resetKey?: string;
  scope: AppErrorBoundaryScope;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

const FALLBACK_COPY: Record<AppErrorBoundaryScope, { heading: string }> = {
  application: {
    heading: "Anwendung konnte nicht angezeigt werden.",
  },
  route: {
    heading: "Arbeitsbereich konnte nicht angezeigt werden.",
  },
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { failed: false };

  private readonly headingRef = createRef<HTMLHeadingElement>();

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  public componentDidCatch(): void {
    this.headingRef.current?.focus();
  }

  public componentDidUpdate(previousProps: AppErrorBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private readonly reload = (): void => {
    if (this.props.reload) {
      this.props.reload();
      return;
    }
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    const copy = FALLBACK_COPY[this.props.scope];
    return (
      <main
        className="app-error-boundary"
        data-error-boundary-scope={this.props.scope}
        role="alert"
      >
        <section className="app-error-boundary__panel">
          <span className="app-error-boundary__symbol" aria-hidden="true">
            !
          </span>
          <h1 ref={this.headingRef} tabIndex={-1}>
            {copy.heading}
          </h1>
          <p>Der letzte bestätigte Stand wurde nicht verändert. Laden Sie die Anwendung neu.</p>
          <button className="app-error-boundary__reload" type="button" onClick={this.reload}>
            Neu laden
          </button>
        </section>
      </main>
    );
  }
}
