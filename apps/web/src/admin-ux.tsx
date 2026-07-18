import {
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardList,
  Database,
  Grid2X2,
  type LucideIcon,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

export type AdminArea =
  | "overview"
  | "setup"
  | "master-data"
  | "users"
  | "evaluation"
  | "audit"
  | "backup";
export type MasterDataCategory =
  | "gates"
  | "resource-groups"
  | "aircraft"
  | "assignments"
  | "pilots"
  | "products";

export type SetupStep = {
  id: string;
  label: string;
  complete: boolean;
  area: AdminArea;
  category?: MasterDataCategory;
};

const navigationItems: Array<{ id: AdminArea; label: string; Icon: LucideIcon }> = [
  { id: "overview", label: "Übersicht", Icon: Grid2X2 },
  { id: "setup", label: "Veranstaltung", Icon: CalendarDays },
  { id: "master-data", label: "Stammdaten", Icon: Database },
  { id: "users", label: "Konten", Icon: UsersRound },
  { id: "evaluation", label: "Auswertung", Icon: ChartNoAxesColumn },
  { id: "audit", label: "Audit", Icon: ClipboardList },
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
  onSelect,
}: {
  steps: SetupStep[];
  onSelect: (step: SetupStep) => void;
}) {
  const firstIncomplete = steps.findIndex((step) => !step.complete);
  const currentIndex = firstIncomplete === -1 ? steps.length - 1 : firstIncomplete;
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
