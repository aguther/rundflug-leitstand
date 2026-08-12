import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function FieldHelp({ help }: Readonly<{ help: string }>) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 16, top: 16 });
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const open = hovered || focused || pinned;

  const close = useCallback(() => {
    setHovered(false);
    setFocused(false);
    setPinned(false);
  }, []);

  const positionTooltip = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const buttonBounds = button.getBoundingClientRect();
    const tooltipWidth = Math.min(230, window.innerWidth - 32);
    const tooltipHeight = tooltipRef.current?.offsetHeight ?? 96;
    const viewportLeft = Math.min(
      Math.max(16, buttonBounds.left - 7),
      window.innerWidth - 16 - tooltipWidth,
    );
    const belowTop = buttonBounds.bottom + 7;
    const viewportTop =
      belowTop + tooltipHeight <= window.innerHeight - 16
        ? belowTop
        : Math.max(16, buttonBounds.top - tooltipHeight - 7);
    setTooltipPosition({ left: viewportLeft, top: viewportTop });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", positionTooltip);
    document.addEventListener("scroll", positionTooltip, true);
    const positionFrame = window.requestAnimationFrame(positionTooltip);
    return () => {
      window.cancelAnimationFrame(positionFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", positionTooltip);
      document.removeEventListener("scroll", positionTooltip, true);
    };
  }, [close, open, positionTooltip]);

  return (
    <button
      aria-describedby={open ? tooltipId : undefined}
      aria-expanded={open}
      aria-label={`Hilfe: ${help}`}
      className={`field-info ${open ? "is-open" : ""}`}
      onBlur={close}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (pinned) close();
        else {
          positionTooltip();
          setPinned(true);
        }
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) {
          positionTooltip();
          setFocused(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onPointerEnter={() => {
        positionTooltip();
        setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") close();
        else setHovered(false);
      }}
      ref={buttonRef}
      tabIndex={-1}
      type="button"
    >
      <Info aria-hidden="true" />
      {open
        ? createPortal(
            <span
              className="field-info-tooltip is-open"
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={tooltipPosition}
            >
              {help}
            </span>,
            document.body,
          )
        : null}
    </button>
  );
}

export function FieldLabel({
  label,
  help,
  htmlFor,
}: Readonly<{
  label: string;
  help: string;
  htmlFor: string;
}>) {
  return (
    <span className="field-label-with-info">
      <label htmlFor={htmlFor}>{label}</label>
      <FieldHelp help={help} />
    </span>
  );
}

export function FieldGroupLabel({ label, help }: Readonly<{ label: string; help: string }>) {
  return (
    <span className="field-label-with-info">
      <span>{label}</span>
      <FieldHelp help={help} />
    </span>
  );
}
