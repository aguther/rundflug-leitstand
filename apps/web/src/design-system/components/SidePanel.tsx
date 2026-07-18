import type { ReactNode } from "react";

export interface SidePanelProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function SidePanel({ open, title, onClose, children, footer }: SidePanelProps) {
  return (
    <>
      <div
        className="ds-sidepanel-backdrop"
        data-open={open}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="ds-sidepanel"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <div className="ds-sidepanel-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="ds-sidepanel-close"
            onClick={onClose}
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
        <div className="ds-sidepanel-body">{children}</div>
        {footer ? <div className="ds-sidepanel-footer">{footer}</div> : null}
      </aside>
    </>
  );
}
