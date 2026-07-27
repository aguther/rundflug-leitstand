import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

export interface SidePanelProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
}

export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
  closeLabel = "Dialog schließen",
}: SidePanelProps) {
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
          <IconButton label={closeLabel} onClick={onClose} size="compact" type="button">
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <div className="ds-sidepanel-body">{children}</div>
        {footer ? <div className="ds-sidepanel-footer">{footer}</div> : null}
      </aside>
    </>
  );
}
