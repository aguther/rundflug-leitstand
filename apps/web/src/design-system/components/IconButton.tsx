import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useState } from "react";
import { BusyIndicator } from "./BusyIndicator";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  size?: "compact" | "default" | "touch";
  busy?: boolean;
  busyLabel?: string;
}

export function IconButton({
  label,
  size = "default",
  className = "",
  busy = false,
  busyLabel,
  children,
  disabled,
  onClick,
  ...rest
}: IconButtonProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const effectiveBusy = busy || internalBusy;
  const actionLabel = busyLabel ?? `${label} wird ausgeführt`;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const result = (
      onClick as ((clickEvent: MouseEvent<HTMLButtonElement>) => unknown) | undefined
    )?.(event);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      setInternalBusy(true);
      void Promise.resolve(result).then(
        () => setInternalBusy(false),
        () => setInternalBusy(false),
      );
    }
  };
  return (
    <button
      aria-busy={effectiveBusy || undefined}
      aria-label={effectiveBusy ? actionLabel : label}
      className={`ds-icon-button ds-icon-button--${size} ${className}`.trim()}
      disabled={disabled || effectiveBusy}
      onClick={handleClick}
      title={label}
      {...rest}
    >
      <span className={`ds-button-content${effectiveBusy ? " ds-button-content--hidden" : ""}`}>
        {children}
      </span>
      {effectiveBusy ? <BusyIndicator label={actionLabel} /> : null}
    </button>
  );
}
