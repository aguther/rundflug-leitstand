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
}: Readonly<SidePanelProps>) {
  return (
    <>
      <div
        className="ds-sidepanel-backdrop"
        data-open={open}
        onClick={onClose}
        aria-hidden="true"
      />
      <dialog
        aria-label={typeof title === "string" ? title : undefined}
        aria-modal="true"
        className="ds-sidepanel"
        data-open={open}
        open={open}
      >
        <div className="ds-sidepanel-header">
          <h2>{title}</h2>
          <IconButton label={closeLabel} onClick={onClose} size="compact" type="button">
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <div className="ds-sidepanel-body">{children}</div>
        {footer ? <div className="ds-sidepanel-footer">{footer}</div> : null}
      </dialog>
    </>
  );
}
