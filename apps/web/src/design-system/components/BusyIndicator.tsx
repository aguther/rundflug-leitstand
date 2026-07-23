import { LoaderCircle } from "lucide-react";

export interface BusyIndicatorProps {
  label?: string;
}

export function BusyIndicator({ label = "Aktion wird ausgeführt" }: BusyIndicatorProps) {
  return (
    <span className="ds-busy-indicator" role="status">
      <LoaderCircle aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
