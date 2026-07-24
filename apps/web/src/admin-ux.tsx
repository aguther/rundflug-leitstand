import {
  CalendarDays,
  ChartNoAxesColumn,
  Grid2X2,
  type LucideIcon,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

export type AdminArea = "overview" | "events" | "users" | "evaluation" | "backup";
export type AdminEventStep =
  | "event"
  | "gates"
  | "resource-groups"
  | "aircraft"
  | "pilots"
  | "products"
  | "operations"
  | "completion";
export type MasterDataCategory =
  | "gates"
  | "resource-groups"
  | "aircraft"
  | "assignments"
  | "pilots"
  | "products";

export type SetupStep = {
  id: AdminEventStep;
  label: string;
  complete: boolean;
  category?: MasterDataCategory;
};

const navigationItems: Array<{ id: AdminArea; label: string; Icon: LucideIcon }> = [
  { id: "overview", label: "Übersicht", Icon: Grid2X2 },
  { id: "events", label: "Veranstaltungen", Icon: CalendarDays },
  { id: "users", label: "Konten", Icon: UsersRound },
  { id: "evaluation", label: "Auswertung", Icon: ChartNoAxesColumn },
  { id: "backup", label: "Sicherung & Reset", Icon: ShieldCheck },
];

export function AdminNavigation({
  activeArea,
  onChange,
}: {
  activeArea: AdminArea;
  onChange: (area: AdminArea) => void;
}) {
  return (
    <nav aria-label="Administration" className="admin-side-nav">
      {navigationItems.map(({ id, label, Icon }) => (
        <button
          aria-current={activeArea === id ? "page" : undefined}
          className={activeArea === id ? "active" : ""}
          key={id}
          onClick={() => onChange(id)}
          type="button"
        >
          <Icon aria-hidden="true" className="admin-nav-icon" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function SetupProgress({
  steps,
  currentStepId,
  onSelect,
}: {
  steps: SetupStep[];
  currentStepId?: AdminEventStep;
  onSelect: (step: SetupStep) => void;
}) {
  const firstIncomplete = steps.findIndex((step) => !step.complete);
  const requestedIndex = currentStepId ? steps.findIndex((step) => step.id === currentStepId) : -1;
  const currentIndex =
    requestedIndex >= 0
      ? requestedIndex
      : firstIncomplete === -1
        ? steps.length - 1
        : firstIncomplete;
  return (
    <ol aria-label="Einrichtungsfortschritt" className="setup-progress">
      {steps.map((step, index) => {
        const state = step.complete ? "complete" : index === currentIndex ? "current" : "pending";
        return (
          <li className={state} key={step.id}>
            <button onClick={() => onSelect(step)} type="button">
              <span className="setup-step-number">{step.complete ? "✓" : index + 1}</span>
              <span>{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const masterDataItems: Array<{ id: MasterDataCategory; label: string }> = [
  { id: "gates", label: "Gates" },
  { id: "resource-groups", label: "Ressourcengruppen" },
  { id: "aircraft", label: "Flugzeuge" },
  { id: "pilots", label: "Pilotencodes" },
  { id: "products", label: "Produkte" },
];

export function MasterDataNavigation({
  activeCategory,
  counts,
  onChange,
}: {
  activeCategory: MasterDataCategory;
  counts: Record<MasterDataCategory, number>;
  onChange: (category: MasterDataCategory) => void;
}) {
  return (
    <nav aria-label="Stammdatenkategorien" className="master-data-nav">
      {masterDataItems.map((item) => (
        <button
          aria-current={activeCategory === item.id ? "page" : undefined}
          className={activeCategory === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <strong>{item.label}</strong>
          <small>{counts[item.id]}</small>
        </button>
      ))}
    </nav>
  );
}

export function ValidationHint({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error";
}) {
  return (
    <div className={`admin-validation ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true">{tone === "info" ? "i" : "!"}</span>
      <p>{children}</p>
    </div>
  );
}
