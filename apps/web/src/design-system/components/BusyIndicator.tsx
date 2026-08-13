import { LoaderCircle } from "lucide-react";

export interface BusyIndicatorProps {
  label?: string;
}

export function BusyIndicator({ label = "Aktion wird ausgeführt" }: Readonly<BusyIndicatorProps>) {
  return (
    <output className="ds-busy-indicator">
      <LoaderCircle aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </output>
  );
}
