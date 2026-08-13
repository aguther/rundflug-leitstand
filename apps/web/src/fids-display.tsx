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

const FIDS_EMPTY_SLOT_KEYS = Array.from(
  { length: 20 },
  (_, index) => `fids-empty-slot-${index + 1}`,
);

function groupCodes(group: FidsBoardRow): string[] {
  return group.bookingGroupLabels?.length
    ? group.bookingGroupLabels
    : [formatBookingGroupLabel(group.productCode, group.communicationNumber)];
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

function forecastPhase(status: FidsBoardRow["status"]): "NOW" | "FINISHED" | "FORECAST" {
  if (status === "COME_TO_FLIGHT_LINE" || status === "BOARDING") return "NOW";
  if (["IN_FLIGHT", "LANDED", "COMPLETED"].includes(status)) return "FINISHED";
  return "FORECAST";
}

function timeWindow(group: FidsBoardRow, timeZone: string): string {
  if (
    ["COME_TO_FLIGHT_LINE", "BOARDING", "IN_FLIGHT", "LANDED", "COMPLETED"].includes(group.status)
  ) {
    return "Jetzt";
  }
  if (group.forecastState === "AFTER_OPERATIONS_END") {
    return "Heute nicht mehr";
  }
  if (group.forecastState === "UNAVAILABLE") {
    if (group.forecastReason === "RETURN_TIME_UNKNOWN") return "Rückkehr offen";
    if (group.forecastReason === "NO_MATCHING_CAPACITY") return "Keine passende Kapazität";
    if (group.forecastReason === "STATUS_CLARIFICATION") return "Statusklärung";
    return "Aktualisierung";
  }
  return formatAbsoluteTimeWindow({
    lowerAt: group.boardingWindowLowerAt,
    upperAt: group.boardingWindowUpperAt,
    timeZone,
    variant: "compact",
    quality: group.predictionQuality,
    phase: forecastPhase(group.status),
  }).replace(" – ", "–");
}

function Status({ group }: Readonly<{ group: FidsBoardRow }>) {
  const presentation = statusPresentation(group.status);
  const Icon = presentation.icon;
  return (
    <div className="fids-status-cell" data-recall-active={group.activeRecall ? "true" : "false"}>
      <strong className={`fids-status tone-${presentation.tone}`}>
        <Icon aria-hidden="true" className="fids-status-icon" />
        <span>{presentation.label}</span>
      </strong>
      {group.activeRecall ? (
        <output
          aria-label={group.activeRecall.fidsMessage}
          className="fids-recall-status"
          title={group.activeRecall.fidsMessage}
        >
          <span aria-hidden="true" className="fids-recall-bell">
            <Bell />
          </span>
          <span>NACHRUF</span>
        </output>
      ) : null}
    </div>
  );
}

function GroupCell({ group }: Readonly<{ group: FidsBoardRow }>) {
  const codes = groupCodes(group);
  return (
    <div className="fids-group-cell" data-group-count={codes.length}>
      <Users aria-hidden="true" />
      <span>
        <strong className="fids-group-codes" title={codes.join(", ")}>
          {codes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </strong>
        {codes.length === 1 ? <small title={group.productName}>{group.productName}</small> : null}
      </span>
    </div>
  );
}

function FidsTable({
  groups,
  compact,
  highlightedRows,
  rowCapacity,
  timeZone,
}: Readonly<{
  groups: FidsBoardRow[];
  compact: boolean;
  highlightedRows: ReadonlySet<string>;
  rowCapacity: number;
  timeZone: string;
}>) {
  const emptySlots = Math.max(0, rowCapacity - groups.length);
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
            {!compact ? (
              <span className="fids-product-cell" title={group.productName}>
                {group.productName}
              </span>
            ) : null}
            <span className="fids-gate-cell" title={group.gateLabel || "Kein Gate"}>
              {group.gateLabel || (
                <>
                  <span aria-hidden="true">–</span>
                  <span className="visually-hidden">Kein Gate</span>
                </>
              )}
            </span>
            <Status group={group} />
            <strong className={`fids-window tone-${statusPresentation(group.status).tone}`}>
              {timeWindow(group, timeZone)}
            </strong>
          </div>
        ))}
        {FIDS_EMPTY_SLOT_KEYS.slice(0, emptySlots).map((slotKey) => (
          <div
            aria-hidden="true"
            className="fids-row fids-row--slot"
            data-testid="fids-empty-slot"
            key={slotKey}
          />
        ))}
      </div>
    </div>
  );
}

function FidsEmptyState({
  message,
  tone,
}: Readonly<{ message: string; tone: "error" | undefined }>) {
  if (!tone) {
    return (
      <output className="fids-section-empty" data-tone="empty">
        {message}
      </output>
    );
  }
  return (
    <p className="fids-section-empty" data-tone={tone} role="alert">
      {message}
    </p>
  );
}

function FidsSection({
  groups,
  highlightedRows,
  label,
  meta,
  rows,
  timeZone,
  emptyMessage,
  emptyTone,
}: Readonly<{
  groups: FidsBoardRow[];
  highlightedRows: ReadonlySet<string>;
  label?: string;
  meta?: ReactNode;
  rows: number;
  timeZone: string;
  emptyMessage: string;
  emptyTone: "error" | undefined;
}>) {
  const leftColumn = groups.filter((_, index) => index % 2 === 0);
  const rightColumn = groups.filter((_, index) => index % 2 === 1);
  const leftColumnCapacity = Math.ceil(rows / 2);
  const rightColumnCapacity = Math.floor(rows / 2);
  const emptyState = groups.length === 0 && rows > 0;
  return (
    <section
      className={`fids-board-section${label ? " fids-board-section--labelled" : ""}`}
      style={
        {
          "--fids-section-rows": rows,
          "--fids-section-single-tracks": rows,
          "--fids-section-double-tracks": Math.ceil(rows / 2),
        } as CSSProperties
      }
    >
      {label ? (
        <header className="fids-section-heading">
          <h2>{label}</h2>
          {meta}
        </header>
      ) : null}
      <div className="fids-single-board">
        <FidsTable
          compact={false}
          groups={groups}
          highlightedRows={highlightedRows}
          rowCapacity={rows}
          timeZone={timeZone}
        />
        {emptyState ? <FidsEmptyState message={emptyMessage} tone={emptyTone} /> : null}
      </div>
      <div className="fids-double-board">
        <FidsTable
          compact
          groups={leftColumn}
          highlightedRows={highlightedRows}
          rowCapacity={leftColumnCapacity}
          timeZone={timeZone}
        />
        <FidsTable
          compact
          groups={rightColumn}
          highlightedRows={highlightedRows}
          rowCapacity={rightColumnCapacity}
          timeZone={timeZone}
        />
        {emptyState ? <FidsEmptyState message={emptyMessage} tone={emptyTone} /> : null}
      </div>
    </section>
  );
}

function selectLogoTheme(
  preferences: FidsPreferences,
  systemTheme: "light" | "dark",
): "light" | "dark" {
  if (preferences.theme === "SYSTEM") return systemTheme;
  return preferences.theme === "DARK" ? "dark" : "light";
}

function fixedBoardEmptyMessage(board: FidsBoardResponse | null, error: string | null): string {
  if (board) return "Aktuell keine Gruppen auf dieser Seite.";
  return error ?? "FIDS-Anzeige wird geladen …";
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
}: Readonly<FidsBoardPresentationProps>) {
  const { system: systemTheme } = useTheme();
  const logoTheme = selectLogoTheme(preferences, systemTheme);
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
  } as CSSProperties & Record<string, number>;
  const split = board?.viewMode === "SPLIT";
  const priorityRows = board?.priority?.effectiveCapacity ?? preferences.priorityGroupCount;
  const lowerRows = board?.page.pageSize ?? Math.max(0, preferences.visibleRows - priorityRows);
  style["--fids-split-single-tracks"] = Math.max(1, priorityRows + lowerRows);
  style["--fids-split-double-tracks"] = Math.max(
    1,
    Math.ceil(priorityRows / 2) + Math.ceil(lowerRows / 2),
  );
  const displayedPage = page;
  const fixedEmptyTone = !board && error ? ("error" as const) : undefined;

  function renderBoardRegion() {
    return (
      <section className="fids-board-region" aria-label="Abflugtafel">
        {board?.emergencyMode || board?.operationalInterrupted ? (
          <div className="standard-alert">Der Rundflugbetrieb ist vorübergehend unterbrochen.</div>
        ) : null}
        {split ? (
          <div className="fids-split-board">
            <FidsSection
              emptyMessage="Derzeit keine unmittelbar relevanten Gruppen."
              emptyTone={undefined}
              groups={board?.priority?.groups ?? []}
              highlightedRows={highlightedRows}
              label="JETZT RELEVANT"
              meta={
                (board?.priority?.overflowCount ?? 0) > 0 ? (
                  <output className="fids-priority-overflow">
                    +{board?.priority?.overflowCount} weitere relevante Gruppen
                  </output>
                ) : null
              }
              rows={priorityRows}
              timeZone={timeZone}
            />
            <FidsSection
              emptyMessage="Derzeit keine weiteren Gruppen."
              emptyTone={undefined}
              groups={board?.page.groups ?? []}
              highlightedRows={highlightedRows}
              label="WEITERE FLÜGE"
              meta={
                (board?.page.totalItems ?? 0) > 0 ? (
                  <output
                    className="fids-section-page"
                    aria-label={`Seite ${board?.page.requestedPage ?? 1} von ${board?.page.totalPages ?? 1}`}
                  >
                    <span className="fids-section-page-prefix">SEITE </span>
                    {board?.page.requestedPage ?? 1} / {board?.page.totalPages ?? 1}
                  </output>
                ) : null
              }
              rows={lowerRows}
              timeZone={timeZone}
            />
          </div>
        ) : (
          <FidsSection
            emptyMessage={fixedBoardEmptyMessage(board, error)}
            emptyTone={fixedEmptyTone}
            groups={board?.page.groups ?? []}
            highlightedRows={highlightedRows}
            rows={preferences.visibleRows}
            timeZone={timeZone}
          />
        )}
      </section>
    );
  }

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

      {renderBoardRegion()}

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
            <button onClick={onCopyLink} type="button">
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
            {!split ? (
              <>
                <i aria-hidden="true" />
                <span>Seite {page}</span>
              </>
            ) : null}
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
}: Readonly<{
  accountCode: string;
  clockOverride?: Date;
  dataSource: FidsDataSource;
  locationAdapter: FidsLocationAdapter;
  onLogout?: () => Promise<void>;
  simulationBanner?: string;
  subtitle?: string;
}>) {
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
        departedVisibilitySeconds={fids.board?.departedVisibilitySeconds ?? 15}
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
