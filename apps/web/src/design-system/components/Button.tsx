import {
  type ButtonHTMLAttributes,
  Children,
  isValidElement,
  type MouseEvent,
  type ReactNode,
  useState,
} from "react";
import { BusyIndicator } from "./BusyIndicator";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "compact" | "default" | "touch";

const variantClass: Record<ButtonVariant, string> = {
  primary: "ds-button--primary",
  secondary: "ds-button--secondary",
  danger: "ds-button--danger",
  ghost: "ds-button--ghost",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

function visibleText(node: ReactNode): string {
  const parts: string[] = [];
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
    } else if (isValidElement<{ children?: ReactNode }>(child)) {
      parts.push(visibleText(child.props.children));
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  busy = false,
  busyLabel,
  children,
  disabled,
  "aria-label": ariaLabel,
  onClick,
  ...rest
}: ButtonProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const effectiveBusy = busy || internalBusy;
  const contentLabel = visibleText(children);
  const actionLabel =
    busyLabel ??
    (ariaLabel
      ? `${ariaLabel} wird ausgeführt`
      : contentLabel
        ? `${contentLabel} wird ausgeführt`
        : "Aktion wird ausgeführt");
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
      aria-label={effectiveBusy ? actionLabel : ariaLabel}
      className={`ds-button ${variantClass[variant]} ds-button--${size} ${className}`.trim()}
      disabled={disabled || effectiveBusy}
      onClick={handleClick}
      {...rest}
    >
      <span className={`ds-button-content${effectiveBusy ? " ds-button-content--hidden" : ""}`}>
        {children}
      </span>
      {effectiveBusy ? <BusyIndicator label={actionLabel} /> : null}
    </button>
  );
}
