import type { EventSnapshot } from "@rundflug/contracts";
import { Database } from "lucide-react";
import type { ReactNode } from "react";
import { AddButton, SearchField } from "../../../design-system/components";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./master-data.css";

export function MasterDataWorkspace({
  event,
  search,
  onSearchChange,
  resultCount,
  addAriaLabel,
  onNew,
  filters,
  children,
}: Readonly<{
  event: EventSnapshot;
  search: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  addAriaLabel: string;
  onNew: () => void;
  filters?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <EventWorkspaceFrame event={event} variant="master-data">
      <div className="master-data-unified-toolbar">
        <SearchField
          label="Stammdaten durchsuchen"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Stammdaten durchsuchen"
          value={search}
        />
        {filters ? <div className="master-data-unified-filters">{filters}</div> : null}
        <span aria-live="polite" className="master-data-result-count">
          {resultCount} {resultCount === 1 ? "Eintrag" : "Einträge"}
        </span>
        <AddButton ariaLabel={addAriaLabel} onClick={onNew} />
      </div>
      <div className="master-data-unified-content">{children}</div>
    </EventWorkspaceFrame>
  );
}

export function MasterDataEmptyState({
  title,
  description,
}: Readonly<{
  title: ReactNode;
  description: ReactNode;
}>) {
  return (
    <div className="master-data-empty master-data-unified-empty">
      <Database aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
