import type { EventSnapshot } from "@rundflug/contracts";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, SearchField } from "../../../design-system/components";
import { EventWorkspaceFrame } from "../event-workspace/EventWorkspaceFrame";
import "./master-data.css";

export function MasterDataWorkspace({
  event,
  search,
  onSearchChange,
  resultCount,
  newLabel,
  onNew,
  filters,
  children,
}: {
  event: EventSnapshot;
  search: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  newLabel: string;
  onNew: () => void;
  filters?: ReactNode;
  children: ReactNode;
}) {
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
        <Button onClick={onNew} type="button" variant="primary">
          <Plus aria-hidden="true" />
          {newLabel}
        </Button>
      </div>
      <div className="master-data-unified-content">{children}</div>
    </EventWorkspaceFrame>
  );
}

export function MasterDataEmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="master-data-empty master-data-unified-empty">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
