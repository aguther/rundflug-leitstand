import {
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  Grid2X2,
  type LucideIcon,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useRef } from "react";

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
          title={label}
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
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentButtonRef = useCallback((element: HTMLButtonElement | null) => {
    element?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, []);
  const firstIncomplete = steps.findIndex((step) => !step.complete);
  const requestedIndex = currentStepId ? steps.findIndex((step) => step.id === currentStepId) : -1;
  const currentIndex =
    requestedIndex >= 0
      ? requestedIndex
      : firstIncomplete === -1
        ? steps.length - 1
        : firstIncomplete;

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? steps.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % steps.length
            : (index - 1 + steps.length) % steps.length;
    const nextStep = steps[nextIndex];
    if (!nextStep) return;
    onSelect(nextStep);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <div aria-label="Veranstaltung einrichten" className="setup-progress" role="tablist">
      {steps.map((step, index) => {
        const current = index === currentIndex;
        const state = [step.complete ? "complete" : "pending", current ? "current" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <div className={`setup-progress-item ${state}`} key={step.id} role="presentation">
            <button
              aria-controls={`admin-event-step-${step.id}-panel`}
              aria-current={current ? "step" : undefined}
              aria-selected={current}
              id={`admin-event-step-${step.id}-tab`}
              onClick={() => onSelect(step)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
              ref={(element) => {
                buttonRefs.current[index] = element;
                if (current) currentButtonRef(element);
              }}
              role="tab"
              tabIndex={current ? 0 : -1}
              type="button"
            >
              <span aria-hidden="true" className="setup-step-status">
                {step.complete ? <Check /> : null}
              </span>
              <span className="setup-step-label">{step.label}</span>
            </button>
          </div>
        );
      })}
    </div>
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
