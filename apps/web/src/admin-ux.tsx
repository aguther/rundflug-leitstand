import type { ReactNode } from "react";

export type AdminArea = "overview" | "setup" | "master-data" | "operations" | "backup";
export type MasterDataCategory = "gates" | "resource-groups" | "aircraft" | "pilots" | "products";

export type SetupStep = {
  id: string;
  label: string;
  complete: boolean;
  area: AdminArea;
  category?: MasterDataCategory;
};

type LineIconName = "overview" | "setup" | "master-data" | "operations" | "backup";

const iconPaths: Record<LineIconName, ReactNode> = {
  overview: (
    <>
      <path d="M3.5 10.5 12 3l8.5 7.5" />
      <path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" />
    </>
  ),
  setup: (
    <>
      <path d="m14.7 6.3 3-3a4.2 4.2 0 0 1-5.3 5.3L5.2 15.8a2.1 2.1 0 1 0 3 3l7.2-7.2a4.2 4.2 0 0 1 5.3-5.3l-3 3" />
    </>
  ),
  "master-data": (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </>
  ),
  operations: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2M7 4.8l1.2 2M4.8 17l2-1.2" />
    </>
  ),
  backup: (
    <>
      <path d="M12 2 4.5 5v6c0 5 3.1 8.7 7.5 11 4.4-2.3 7.5-6 7.5-11V5L12 2Z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
};

function LineIcon({ name }: { name: LineIconName }) {
  return (
    <svg aria-hidden="true" className="admin-nav-icon" viewBox="0 0 24 24">
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        {iconPaths[name]}
      </g>
    </svg>
  );
}

const navigationItems: Array<{ id: AdminArea; label: string; icon: LineIconName }> = [
  { id: "overview", label: "Übersicht", icon: "overview" },
  { id: "setup", label: "Einrichtung", icon: "setup" },
  { id: "master-data", label: "Stammdaten", icon: "master-data" },
  { id: "operations", label: "Betrieb", icon: "operations" },
  { id: "backup", label: "Sicherung & Reset", icon: "backup" },
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
      {navigationItems.map((item) => (
        <button
          aria-current={activeArea === item.id ? "page" : undefined}
          className={activeArea === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <LineIcon name={item.icon} />
          <span>{item.label}</span>
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
  { id: "pilots", label: "Piloten" },
  { id: "products", label: "Produkte" },
];

export function MasterDataNavigation({
  activeCategory,
  onChange,
}: {
  activeCategory: MasterDataCategory;
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
          {item.label}
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
  tone?: "info" | "error";
}) {
  return (
    <div className={`admin-validation ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span aria-hidden="true">{tone === "error" ? "!" : "i"}</span>
      <p>{children}</p>
    </div>
  );
}
