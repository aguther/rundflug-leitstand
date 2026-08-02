import type { FidsBoardResponse, FidsBoardRow, FidsPreferences } from "@rundflug/contracts";
import { formatBookingGroupLabel } from "@rundflug/domain";
import {
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleArrowRight,
  Clock3,
  Copy,
  PlaneTakeoff,
  QrCode,
  Settings,
  TicketsPlane,
  Users,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { BrandMark } from "./design-system/BrandMark";
import { useTheme } from "./design-system/theme";
import { FidsSettingsDialog } from "./features/fids/FidsSettingsDialog";
import type { FidsDataSource } from "./features/fids/fids-data-source";
import type { FidsLocationAdapter } from "./features/fids/fids-location";
import { useFidsExperience } from "./features/fids/useFidsExperience";
import { formatAbsoluteTimeWindow } from "./time-window";

function groupCode(group: FidsBoardRow): string {
  return formatBookingGroupLabel(group.productCode, group.communicationNumber);
}

function statusPresentation(status: FidsBoardRow["status"]): {
  label: string;
  tone: string;
  icon: typeof Clock3;
} {
  if (status === "COME_TO_FLIGHT_LINE")
    return { label: "BITTE ZUM GATE", tone: "gate", icon: CircleArrowRight };
  if (status === "PREPARE") return { label: "BEREITHALTEN", tone: "prepare", icon: Clock3 };
  if (status === "BOARDING") return { label: "BOARDING", tone: "boarding", icon: TicketsPlane };
  if (status === "IN_FLIGHT") return { label: "ABGEFLOGEN", tone: "departed", icon: PlaneTakeoff };
  if (status === "LANDED") return { label: "GELANDET", tone: "departed", icon: PlaneTakeoff };
  if (status === "COMPLETED")
    return { label: "ABGESCHLOSSEN", tone: "departed", icon: PlaneTakeoff };
  if (status === "SERVICE_PAUSED") return { label: "VERZÖGERT", tone: "delayed", icon: Clock3 };
  return { label: "WARTEN", tone: "standby", icon: Clock3 };
}

function timeWindow(group: FidsBoardRow, timeZone: string): string {
  return formatAbsoluteTimeWindow({
    lowerAt: group.boardingWindowLowerAt,
    upperAt: group.boardingWindowUpperAt,
    maximumWidthMinutes: 60,
    timeZone,
    includeClockSuffix: false,
    quality: group.predictionQuality,
    phase:
      group.status === "COME_TO_FLIGHT_LINE" || group.status === "BOARDING"
        ? "NOW"
        : ["IN_FLIGHT", "LANDED", "COMPLETED"].includes(group.status)
          ? "FINISHED"
          : "FORECAST",
  });
}

function Status({ group }: { group: FidsBoardRow }) {
  const presentation = statusPresentation(group.status);
  const Icon = presentation.icon;
  return (
    <div className="fids-status-cell" data-recall-active={group.activeRecall ? "true" : "false"}>
      <strong className={`fids-status tone-${presentation.tone}`}>
        <Icon aria-hidden="true" className="fids-status-icon" />
        <span>{presentation.label}</span>
      </strong>
      {group.activeRecall ? (
        <strong
          aria-label={group.activeRecall.fidsMessage}
          className="fids-recall-status"
          role="status"
          title={group.activeRecall.fidsMessage}
        >
          <span aria-hidden="true" className="fids-recall-bell">
            <Bell />
          </span>
          <span>NACHRUF</span>
        </strong>
      ) : null}
    </div>
  );
}

function GroupCell({ group }: { group: FidsBoardRow }) {
  return (
    <div className="fids-group-cell">
      <Users aria-hidden="true" />
      <span>
        <strong>{groupCode(group)}</strong>
        <small>{group.productName}</small>
      </span>
    </div>
  );
}

function FidsTable({
  groups,
  compact,
  highlightedRows,
  timeZone,
}: {
  groups: FidsBoardRow[];
  compact: boolean;
  highlightedRows: ReadonlySet<string>;
  timeZone: string;
}) {
  return (
    <div className={`fids-table ${compact ? "fids-table--compact" : "fids-table--wide"}`}>
      <div className="fids-grid-head" aria-hidden="true">
        <span>
          {compact ? (
            "Gruppe / Rundflug"
          ) : (
            <>
              <span className="fids-head-wide">Gruppe</span>
              <span className="fids-head-narrow">Gruppe / Rundflug</span>
            </>
          )}
        </span>
        {!compact ? <span>Rundflug</span> : null}
        <span>Gate</span>
        <span>Status</span>
        <span>Zeitfenster</span>
      </div>
      <div className="fids-table-body">
        {groups.map((group) => (
          <div
            className="fids-row"
            data-highlighted={highlightedRows.has(group.rowId) ? "true" : "false"}
            data-recall-active={group.activeRecall ? "true" : "false"}
            key={group.rowId}
          >
            <GroupCell group={group} />
            {!compact ? <span className="fids-product-cell">{group.productName}</span> : null}
            <span className="fids-gate-cell">{group.gateLabel || "–"}</span>
            <Status group={group} />
            <strong className={`fids-window tone-${statusPresentation(group.status).tone}`}>
              {timeWindow(group, timeZone)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function FidsSection({
  groups,
  highlightedRows,
  label,
  rows,
  timeZone,
}: {
  groups: FidsBoardRow[];
  highlightedRows: ReadonlySet<string>;
  label?: string;
  rows: number;
  timeZone: string;
}) {
  const leftColumn = groups.filter((_, index) => index % 2 === 0);
  const rightColumn = groups.filter((_, index) => index % 2 === 1);
  return (
    <section
      className="fids-board-section"
      style={
        {
          "--fids-section-rows": Math.max(1, rows),
          "--fids-double-rows": Math.max(1, Math.ceil(rows / 2)),
        } as CSSProperties
      }
    >
      {label ? <h2>{label}</h2> : null}
      <div className="fids-single-board">
        <FidsTable
          compact={false}
          groups={groups}
          highlightedRows={highlightedRows}
          timeZone={timeZone}
        />
      </div>
      <div className="fids-double-board">
        <FidsTable
          compact
          groups={leftColumn}
          highlightedRows={highlightedRows}
          timeZone={timeZone}
        />
        <FidsTable
          compact
          groups={rightColumn}
          highlightedRows={highlightedRows}
          timeZone={timeZone}
        />
      </div>
    </section>
  );
}

export interface FidsBoardPresentationProps {
  board: FidsBoardResponse | null;
  children?: ReactNode;
  preferences: FidsPreferences;
  clock: Date;
  connectionLabel: string;
  connectionTone: "connected" | "offline" | "simulation";
  error: string | null;
  highlightedRows?: ReadonlySet<string>;
  linkCopied?: boolean;
  onCopyLink?: () => void;
  onOpenSettings?: () => void;
  onSetPage?: (page: number) => void;
  onStopSetup?: () => void;
  page?: number;
  setupMode?: boolean;
  simulationBanner?: string;
  subtitle?: string;
}

export function FidsBoardPresentation({
  board,
  children,
  preferences,
  clock,
  connectionLabel,
  connectionTone,
  error,
  highlightedRows = new Set(),
  linkCopied = false,
  onCopyLink,
  onOpenSettings,
  onSetPage,
  onStopSetup,
  page = 1,
  setupMode = false,
  simulationBanner,
  subtitle,
}: FidsBoardPresentationProps) {
  const { system: systemTheme } = useTheme();
  const logoTheme =
    preferences.theme === "SYSTEM" ? systemTheme : preferences.theme === "DARK" ? "dark" : "light";
  const timeZone = board?.timeZone ?? "Europe/Berlin";
  const time = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(clock);
  const date = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(clock);
  const style = {
    "--fids-single-rows": preferences.visibleRows,
    "--fids-double-rows": Math.ceil(preferences.visibleRows / 2),
  } as CSSProperties;
  const split = board?.viewMode === "SPLIT";
  const priorityRows = board?.priority?.effectiveCapacity ?? preferences.priorityGroupCount;
  const totalGroups = (board?.priority?.groups.length ?? 0) + (board?.page.groups.length ?? 0);
  const displayedPage = page;

  return (
    <main
      className="standard-fids"
      data-fids-layout={preferences.layout.toLowerCase()}
      data-fids-mode={simulationBanner ? "simulation" : "standard"}
      data-fids-theme={preferences.theme.toLowerCase()}
      data-fids-view={split ? "split" : "fixed"}
      data-setup={setupMode ? "true" : "false"}
      data-testid="fids-display"
      style={style}
    >
      {simulationBanner ? (
        <div className="fids-simulation-banner">
          <AlertTriangle aria-hidden="true" />
          <span>{simulationBanner}</span>
        </div>
      ) : null}
      <header className="fids-header">
        <div className="standard-mark">
          <BrandMark theme={logoTheme} />
        </div>
        <div className="fids-title">
          <h1>{board?.eventName ?? "Veranstaltung"}</h1>
          <p>{subtitle ?? "Abflugtafel"}</p>
        </div>
        <div className="standard-clock">
          <b>{time}</b>
          <span>{date}</span>
          <em className={connectionTone}>
            <i aria-hidden="true" /> {connectionLabel}
          </em>
        </div>
      </header>

      <section className="fids-board-region" aria-label="Abflugtafel">
        {board?.emergencyMode || board?.operationalInterrupted ? (
          <div className="standard-alert">Der Rundflugbetrieb ist vorübergehend unterbrochen.</div>
        ) : null}
        {split ? (
          <div className="fids-split-board">
            <FidsSection
              groups={board?.priority?.groups ?? []}
              highlightedRows={highlightedRows}
              label="JETZT RELEVANT"
              rows={priorityRows}
              timeZone={timeZone}
            />
            <FidsSection
              groups={board?.page.groups ?? []}
              highlightedRows={highlightedRows}
              label="WEITERE FLÜGE"
              rows={board?.page.pageSize ?? Math.max(0, preferences.visibleRows - priorityRows)}
              timeZone={timeZone}
            />
            {(board?.priority?.overflowCount ?? 0) > 0 ? (
              <p className="fids-priority-overflow" role="status">
                +{board?.priority?.overflowCount} weitere dringende Gruppen
              </p>
            ) : null}
          </div>
        ) : (
          <FidsSection
            groups={board?.page.groups ?? []}
            highlightedRows={highlightedRows}
            rows={preferences.visibleRows}
            timeZone={timeZone}
          />
        )}
        {totalGroups === 0 ? (
          <div className="standard-empty">{error ?? "Aktuell keine Gruppen auf dieser Seite."}</div>
        ) : null}
      </section>

      <footer className="fids-footer">
        {setupMode ? (
          <fieldset className="fids-setup-tray" aria-label="FIDS-Setup">
            <button
              aria-label="Vorherige Seite"
              disabled={displayedPage <= 1}
              onClick={() => onSetPage?.(Math.max(1, displayedPage - 1))}
              type="button"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <strong>
              Seite {displayedPage}
              {board?.page.totalPages ? ` / ${board.page.totalPages}` : ""}
            </strong>
            <button
              aria-label="Nächste Seite"
              onClick={() => onSetPage?.(Math.min(999, displayedPage + 1))}
              type="button"
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button onClick={() => void onCopyLink?.()} type="button">
              <Copy aria-hidden="true" /> {linkCopied ? "Kopiert" : "Link kopieren"}
            </button>
            <button onClick={onStopSetup} type="button">
              Setup beenden
            </button>
          </fieldset>
        ) : (
          <div className="fids-footer-copy">
            <span>
              <QrCode aria-hidden="true" /> Bitte QR-Ticket bereithalten
            </span>
            <i aria-hidden="true" />
            <span>Zeitfenster sind Prognosen</span>
            <i aria-hidden="true" />
            <span>{split ? `Unterseite ${board?.page.requestedPage ?? 1}` : `Seite ${page}`}</span>
          </div>
        )}
        {onOpenSettings ? (
          <button
            aria-label="FIDS-Einstellungen öffnen"
            className="fids-settings-button"
            onClick={onOpenSettings}
            type="button"
          >
            <Settings aria-hidden="true" />
          </button>
        ) : null}
      </footer>
      {children}
    </main>
  );
}

export function FidsDisplay({
  accountCode,
  clockOverride,
  dataSource,
  locationAdapter,
  onLogout,
  simulationBanner,
  subtitle,
}: {
  accountCode: string;
  clockOverride?: Date;
  dataSource: FidsDataSource;
  locationAdapter: FidsLocationAdapter;
  onLogout?: () => Promise<void>;
  simulationBanner?: string;
  subtitle?: string;
}) {
  const fids = useFidsExperience({ dataSource, locationAdapter });
  return (
    <FidsBoardPresentation
      board={fids.board}
      clock={clockOverride ?? fids.clock}
      connectionLabel={fids.connection.label}
      connectionTone={fids.connection.tone}
      error={fids.error}
      highlightedRows={fids.highlightedRows}
      linkCopied={fids.linkCopied}
      onCopyLink={fids.copyShareableUrl}
      onOpenSettings={() => fids.setSettingsOpen(true)}
      onSetPage={fids.setPage}
      onStopSetup={() => fids.setSetupMode(false)}
      page={fids.page}
      preferences={fids.preferences}
      setupMode={fids.setupMode}
      {...(simulationBanner ? { simulationBanner } : {})}
      {...(subtitle ? { subtitle } : {})}
    >
      <FidsSettingsDialog
        accountCode={accountCode}
        eventName={fids.board?.eventName ?? "Veranstaltung"}
        filterOptions={fids.filterOptions}
        filterOptionsLoaded={fids.filterOptionsLoaded}
        onClose={() => fids.setSettingsOpen(false)}
        {...(onLogout ? { onLogout } : {})}
        onSave={fids.savePreferences}
        onSetSetupMode={fids.setSetupMode}
        open={fids.settingsOpen}
        page={fids.page}
        preferences={fids.preferences}
        setupMode={fids.setupMode}
      />
    </FidsBoardPresentation>
  );
}
