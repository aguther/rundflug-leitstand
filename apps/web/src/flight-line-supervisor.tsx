import type { OperationBoard } from "@rundflug/contracts";
import { useMemo, useState } from "react";
import { BrandMark } from "./design-system/BrandMark";
import { ThemeToggle } from "./design-system/ThemeToggle";
import { useAuth } from "./features/auth/AuthContext";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];

type SupervisorAction = {
  label: string;
  disabled: boolean;
  run: () => void;
} | null;

const stages = [
  ["ready", "Bereit"],
  ["gate", "Go to Gate"],
  ["boarding", "Boarding"],
  ["off-block", "Off-Block"],
  ["on-block", "On-Block"],
  ["refueling", "Tanken"],
  ["paused", "Pause"],
  ["unavailable", "Nicht verfügbar"],
] as const;

function stageFor(aircraft: Aircraft, rotation: Rotation | undefined): string {
  if (aircraft.operationalState === "REFUELING") return "refueling";
  if (aircraft.operationalState === "PAUSED") return "paused";
  if (["INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState)) return "unavailable";
  if (rotation?.status === "CALLED" || aircraft.operationalState === "BOARDING") return "boarding";
  if (rotation?.status === "IN_FLIGHT" || aircraft.operationalState === "IN_FLIGHT") {
    return "off-block";
  }
  if (rotation?.status === "LANDED" || aircraft.operationalState === "LANDED") return "on-block";
  return "ready";
}

function stateLabel(aircraft: Aircraft, rotation: Rotation | undefined): string {
  const stage = stageFor(aircraft, rotation);
  return stages.find(([key]) => key === stage)?.[1] ?? "Bereit";
}

function formatTime(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

type SidebarView = "fleet" | "groups" | "refueling" | "maintenance" | "activity";

const sidebarNavItems: Array<{ id: SidebarView; label: string } | { href: string; label: string }> =
  [
    { id: "fleet", label: "Flight Line" },
    { id: "groups", label: "Gruppen" },
    { href: "/admin?area=master-data&section=gates", label: "Gates" },
    { href: "/admin?area=master-data&section=resource-groups", label: "Ressourcen" },
    { href: "/admin?area=master-data&section=pilots", label: "Piloten" },
    { href: "/admin?area=master-data&section=aircraft", label: "Flugzeuge" },
    { id: "refueling", label: "Tanken" },
    { id: "maintenance", label: "Wartung" },
    { id: "activity", label: "Abläufe" },
    { href: "/admin?area=evaluation", label: "Berichte" },
    { href: "/admin?area=setup", label: "Einstellungen" },
  ];

type DetailTab = "assignment" | "info" | "pilot" | "history" | "notes";

const detailTabs: Array<{ id: DetailTab; label: string }> = [
  { id: "assignment", label: "Vorgeschlagene Zuordnung" },
  { id: "info", label: "Flugzeuginfo" },
  { id: "pilot", label: "Pilot" },
  { id: "history", label: "Historie" },
  { id: "notes", label: "Notizen" },
];

function suggestedRotationFor(
  aircraft: Aircraft,
  rotations: Rotation[],
  products: OperationBoard["products"],
): Rotation | undefined {
  const assigned = rotations.find(
    (rotation) => rotation.aircraftId === aircraft.id && rotation.status !== "COMPLETED",
  );
  if (assigned) return assigned;
  return rotations.find((rotation) => {
    if (rotation.status !== "DRAFT") return false;
    const product = products.find((entry) => entry.code === rotation.productCode);
    return (
      product?.resourceGroupId === aircraft.resourceGroupId &&
      rotation.ticketCount <= aircraft.passengerSeats
    );
  });
}

export function FlightLineSupervisorConsole({
  board,
  aircraft,
  selectedAircraft,
  selectedRotation,
  aircraftRotations,
  action,
  message,
  nextPilotId,
  onPilotChange,
  onSelectAircraft,
  onSelectRotation,
  onOpenDetails,
  onOpenDisposition,
  onPause,
  onRefuel,
  onUnavailable,
  onAvailable,
  onDeferRotation,
  onReleaseAssist,
}: {
  board: OperationBoard;
  aircraft: Aircraft[];
  selectedAircraft: Aircraft | undefined;
  selectedRotation: Rotation | undefined;
  aircraftRotations: Rotation[];
  action: SupervisorAction;
  message: string | null;
  nextPilotId: string;
  onPilotChange: (pilotId: string) => void;
  onSelectAircraft: (aircraftId: string) => void;
  onSelectRotation: (rotationId: string) => void;
  onOpenDetails: () => void;
  onOpenDisposition: () => void;
  onPause: () => void;
  onRefuel: () => void;
  onUnavailable: () => void;
  onAvailable: () => void;
  onDeferRotation: (rotation: Rotation) => void;
  onReleaseAssist: (aircraftId: string) => void;
}) {
  const { session, logout } = useAuth();
  const [search, setSearch] = useState("");
  const [resourceGroupId, setResourceGroupId] = useState("");
  const [sidebarView, setSidebarView] = useState<SidebarView>("fleet");
  const [detailTab, setDetailTab] = useState<DetailTab>("assignment");
  const filteredAircraft = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("de-DE");
    return aircraft.filter((entry) => {
      const matchesResource = !resourceGroupId || entry.resourceGroupId === resourceGroupId;
      const matchesSearch =
        !normalizedSearch ||
        `${entry.registration} ${entry.aircraftType} ${entry.resourceGroupName}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedSearch);
      return matchesResource && matchesSearch;
    });
  }, [aircraft, resourceGroupId, search]);
  const currentTime = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: board.event.timeZone,
  }).format(new Date());
  const eventDate = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: board.event.timeZone,
  }).format(new Date(`${board.event.eventDate}T12:00:00Z`));

  return (
    <section className="flight-line-console">
      <header className="flight-line-console-header">
        <div className="flight-line-console-brand">
          <BrandMark />
          <div>
            <strong>Flight Line</strong>
            <small>Rundflug-Leitstand</small>
          </div>
        </div>
        <div className="console-live-state">
          <span />
          Leitstand aktiv
        </div>
        <time dateTime={new Date().toISOString()}>
          <strong>{currentTime}</strong>
          <small>{eventDate}</small>
        </time>
        <div className="console-header-context">
          <span>Hinweise</span>
          <strong>{board.event.operationalNote ? "1" : "0"}</strong>
          <span className="console-online">● Online</span>
          <a href="/flight-line/assist">Assist</a>
          <ThemeToggle />
          <button onClick={() => void logout().then(() => window.location.reload())} type="button">
            {session?.account.loginCode ?? "Leitstand"}
          </button>
        </div>
      </header>

      <aside className="flight-line-console-nav" aria-label="Flight-Line-Bereiche">
        {sidebarNavItems.map((item) =>
          "href" in item ? (
            <a href={item.href} key={item.label}>
              {item.label}
            </a>
          ) : (
            <button
              className={sidebarView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setSidebarView(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ),
        )}
      </aside>

      <aside className="console-aircraft-list">
        <div className="console-panel-title">
          <div>
            <strong>Flugzeuge</strong>
            <small>{aircraft.length} insgesamt</small>
          </div>
          <label className="console-aircraft-search">
            <span className="visually-hidden">Flugzeug suchen</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suchen…"
              type="search"
              value={search}
            />
          </label>
        </div>
        <div className="console-aircraft-table-head">
          <span>Flugzeug</span>
          <span>Plätze</span>
          <span>Ressource</span>
          <span>Status</span>
        </div>
        <div className="console-aircraft-rows">
          {filteredAircraft.map((entry) => {
            const rotation = suggestedRotationFor(entry, board.rotations, board.products);
            const selected = entry.id === selectedAircraft?.id;
            return (
              <button
                className={selected ? "selected" : ""}
                key={entry.id}
                onClick={() => onSelectAircraft(entry.id)}
                type="button"
              >
                <span>
                  <strong>{entry.registration}</strong>
                  <small>{entry.aircraftType}</small>
                </span>
                <span>{entry.passengerSeats}</span>
                <span>{entry.resourceGroupName}</span>
                <span className={`console-status status-${stageFor(entry, rotation)}`}>
                  {stateLabel(entry, rotation)}
                </span>
              </button>
            );
          })}
        </div>
        <small className="console-list-count">
          {filteredAircraft.length} von {aircraft.length} Flugzeugen
        </small>
      </aside>

      <main className="flight-line-console-main">
        <div className="console-toolbar">
          <div>
            <strong>{selectedAircraft?.registration ?? "Flight Line"}</strong>
            <small>Flugzeug übernehmen, passende Gruppe wählen und Boarding bestätigen</small>
          </div>
          <div>
            <label className="console-resource-filter">
              <span className="visually-hidden">Ressource filtern</span>
              <select
                onChange={(event) => setResourceGroupId(event.target.value)}
                value={resourceGroupId}
              >
                <option value="">Alle Ressourcen</option>
                {board.resourceGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>+ Aktion</summary>
              <div>
                <button onClick={onPause} type="button">
                  Pause
                </button>
                <button onClick={onRefuel} type="button">
                  Tanken
                </button>
                <button onClick={onUnavailable} type="button">
                  Nicht verfügbar
                </button>
                <button onClick={onAvailable} type="button">
                  Wieder verfügbar
                </button>
              </div>
            </details>
          </div>
        </div>

        <nav className="aircraft-selector-rail" aria-label="Flugzeug übernehmen">
          {filteredAircraft.map((entry) => {
            const rotation = suggestedRotationFor(entry, board.rotations, board.products);
            return (
              <button
                aria-current={entry.id === selectedAircraft?.id ? "true" : undefined}
                className={entry.id === selectedAircraft?.id ? "selected" : ""}
                key={entry.id}
                onClick={() => onSelectAircraft(entry.id)}
                type="button"
              >
                <strong>{entry.registration}</strong>
                <span>{stateLabel(entry, rotation)}</span>
                <small>
                  {entry.passengerSeats} Plätze · {entry.resourceGroupName}
                </small>
              </button>
            );
          })}
        </nav>

        {sidebarView !== "fleet" ? (
          <SupervisorSidebarPanel
            view={sidebarView}
            board={board}
            timeZone={board.event.timeZone}
          />
        ) : null}

        <section
          className="console-status-matrix"
          aria-label="Flugzeugstatus"
          hidden={sidebarView !== "fleet"}
        >
          <div className="console-matrix-head">
            <span>Flugzeug</span>
            <span>Status</span>
            <span>Aktuelle Zuordnung</span>
            {stages.map(([, label]) => (
              <span key={label}>{label}</span>
            ))}
            <span>Aktionen</span>
          </div>
          {filteredAircraft.map((entry) => {
            const rotation = suggestedRotationFor(entry, board.rotations, board.products);
            const assistClaim = (board.assistClaims ?? []).find(
              (claim) => claim.aircraftId === entry.id,
            );
            const currentStage = stageFor(entry, rotation);
            const selected = entry.id === selectedAircraft?.id;
            return (
              <div
                className={selected ? "console-matrix-row selected" : "console-matrix-row"}
                key={entry.id}
              >
                <button
                  className="matrix-aircraft"
                  onClick={() => onSelectAircraft(entry.id)}
                  type="button"
                >
                  <strong>{entry.registration}</strong>
                  <small>{entry.aircraftType}</small>
                </button>
                <span className={`console-status status-${currentStage}`}>
                  {stateLabel(entry, rotation)}
                </span>
                <span className="matrix-assignment">
                  {rotation ? (
                    <>
                      <strong>
                        {rotation.communicationLabel} · {rotation.ticketCount} Tickets
                      </strong>
                      <small>{rotation.gateLabel}</small>
                      {rotation.precalledAt ? (
                        <small>GO TO GATE · Gruppe ist vorgerufen</small>
                      ) : null}
                    </>
                  ) : (
                    "–"
                  )}
                  {assistClaim ? <small>Assist-Gerät betreut</small> : null}
                </span>
                {stages.map(([key, label]) => (
                  <span
                    className={
                      key === currentStage ? `matrix-stage active stage-${key}` : "matrix-stage"
                    }
                    key={key}
                    title={label}
                  />
                ))}
                <button
                  className="matrix-details"
                  onClick={() => {
                    onSelectAircraft(entry.id);
                    onOpenDetails();
                  }}
                  type="button"
                >
                  Details
                </button>
                {selected && rotation ? (
                  <div className="matrix-recommendation">
                    <div>
                      <small>Empfehlung</small>
                      <strong>{rotation.communicationLabel} für dieses Flugzeug übernehmen</strong>
                      <span>
                        Vorgeschlagenes Zeitfenster bis{" "}
                        {formatTime(rotation.timeline.predicted.boardingAt, board.event.timeZone)}
                      </span>
                    </div>
                    <div>
                      <small>Begründung (informativ)</small>
                      <span>Flugzeug und Gruppe passen zur gemeinsamen Ressource.</span>
                    </div>
                    <div>
                      <small>Bestätigung durch Operator erforderlich</small>
                      <span>Keine automatische Zuweisung oder Sicherheitsentscheidung.</span>
                    </div>
                    {action ? (
                      <button
                        className="console-confirm"
                        disabled={action.disabled}
                        onClick={action.run}
                        type="button"
                      >
                        {action.label}
                      </button>
                    ) : null}
                    <button onClick={onOpenDisposition} type="button">
                      Andere Gruppe
                    </button>
                    {assistClaim ? (
                      <button onClick={() => onReleaseAssist(entry.id)} type="button">
                        Assist freigeben
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <div className="console-bottom-grid" hidden={sidebarView !== "fleet"}>
          <section className="console-next-groups aircraft-queue-panel">
            <div className="console-panel-title">
              <div>
                <strong>
                  Passende Queue für {selectedAircraft?.registration ?? "das Flugzeug"}
                </strong>
                <small>
                  Die Reihenfolge ist eine Empfehlung; abwesende Gruppen können zurückgestellt
                  werden.
                </small>
              </div>
              <span className="automatic-gate-status">
                <strong>
                  {selectedRotation?.precalledAt
                    ? "GO TO GATE ausgelöst"
                    : "GO TO GATE automatisch aktiv"}
                </strong>
                <small>
                  {selectedRotation?.precalledAt
                    ? `${selectedRotation.communicationLabel} wurde automatisch zum Gate gerufen`
                    : "Prognose wird laufend aus heutigen Ist-Zeiten aktualisiert"}
                </small>
              </span>
            </div>
            <div className="next-group-head">
              <span>Pos.</span>
              <span>Gruppe</span>
              <span>Tickets</span>
              <span>Anwesenheit</span>
              <span>Erwartetes Fenster</span>
              <span>Aktion</span>
            </div>
            {aircraftRotations.map((rotation, index) => (
              <div
                className={rotation.id === selectedRotation?.id ? "selected" : ""}
                key={rotation.id}
              >
                <button
                  className="queue-row-select"
                  onClick={() => onSelectRotation(rotation.id)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{rotation.communicationLabel}</strong>
                  <span>{rotation.ticketCount}</span>
                  <span>
                    {
                      rotation.tickets.filter((ticket) => ticket.attendanceStatus === "CHECKED_IN")
                        .length
                    }
                    /{rotation.ticketCount} anwesend
                  </span>
                  <span>
                    {rotation.predictedLowerMinutes}–{rotation.predictedUpperMinutes} Min.
                  </span>
                </button>
                <button
                  className="queue-defer"
                  onClick={() => onDeferRotation(rotation)}
                  type="button"
                >
                  Zurückstellen
                </button>
              </div>
            ))}
            {aircraftRotations.length === 0 ? <p>Keine passende Gruppe wartet derzeit.</p> : null}
            <small>
              Letzte Aktualisierung: {formatTime(board.event.updatedAt, board.event.timeZone)}
            </small>
          </section>

          <section className="console-aircraft-detail">
            <div className="console-panel-title">
              <strong>{selectedAircraft?.registration ?? "Kein Flugzeug"}</strong>
              <small>{selectedAircraft?.aircraftType}</small>
            </div>
            <div role="tablist" aria-label="Flugzeugdetails">
              {detailTabs.map((tab) => (
                <button
                  aria-selected={detailTab === tab.id}
                  className={detailTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setDetailTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {selectedAircraft ? (
              <div className="console-detail-content" role="tabpanel">
                {detailTab === "assignment" ? (
                  <>
                    <dl>
                      <div>
                        <dt>Gruppe</dt>
                        <dd>
                          {selectedRotation
                            ? `${selectedRotation.communicationLabel} · ${selectedRotation.ticketCount} Tickets`
                            : "–"}
                        </dd>
                      </div>
                      <div>
                        <dt>Gate</dt>
                        <dd>
                          {selectedRotation?.gateLabel ??
                            board.resourceGroups.find(
                              (group) => group.id === selectedAircraft.resourceGroupId,
                            )?.gateLabel ??
                            "–"}
                        </dd>
                      </div>
                      <div>
                        <dt>Vorgeschlagene Zeit</dt>
                        <dd>
                          {selectedRotation
                            ? `${selectedRotation.predictedLowerMinutes}–${selectedRotation.predictedUpperMinutes} Min.`
                            : "–"}
                        </dd>
                      </div>
                    </dl>
                    <div className="console-info-note">
                      <strong>Hinweis</strong>
                      <span>
                        Diese Empfehlung ist informativ. Die finale Entscheidung liegt beim
                        Operator.
                      </span>
                    </div>
                    {selectedRotation?.status === "DRAFT" ? (
                      <label className="aircraft-assignment-pilot">
                        <span>Pilot für diese Belegung</span>
                        <select
                          aria-label="Pilotencode für die Belegung"
                          value={nextPilotId}
                          onChange={(event) => onPilotChange(event.target.value)}
                        >
                          <option value="">Pilot wählen</option>
                          {board.pilots
                            .filter((pilot) => pilot.active && !pilot.paused)
                            .map((pilot) => (
                              <option key={pilot.id} value={pilot.id}>
                                {pilot.operationalCode}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                    {action ? (
                      <button
                        className="console-confirm assignment-confirm"
                        disabled={action.disabled}
                        onClick={action.run}
                        type="button"
                      >
                        {action.label}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {detailTab === "info" ? (
                  <dl>
                    <div>
                      <dt>Status</dt>
                      <dd>{stateLabel(selectedAircraft, selectedRotation)}</dd>
                    </div>
                    <div>
                      <dt>Ressource</dt>
                      <dd>{selectedAircraft.resourceGroupName}</dd>
                    </div>
                    <div>
                      <dt>Flugzeugtyp</dt>
                      <dd>{selectedAircraft.aircraftType}</dd>
                    </div>
                    <div>
                      <dt>Sitzplätze</dt>
                      <dd>{selectedAircraft.passengerSeats}</dd>
                    </div>
                    <div>
                      <dt>Umläufe seit Tanken</dt>
                      <dd>{selectedAircraft.rotationsSinceRefuel}</dd>
                    </div>
                  </dl>
                ) : null}
                {detailTab === "pilot" ? (
                  <dl>
                    <div>
                      <dt>Pilotencode</dt>
                      <dd>
                        {selectedRotation?.status === "DRAFT" ? (
                          <select
                            aria-label="Pilotencode für die Belegung"
                            value={nextPilotId}
                            onChange={(event) => onPilotChange(event.target.value)}
                          >
                            <option value="">Pilot wählen</option>
                            {board.pilots
                              .filter((pilot) => pilot.active && !pilot.paused)
                              .map((pilot) => (
                                <option key={pilot.id} value={pilot.id}>
                                  {pilot.operationalCode}
                                </option>
                              ))}
                          </select>
                        ) : (
                          (selectedRotation?.pilotOperationalCode ?? "–")
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {detailTab === "history" ? (
                  <p className="console-info-note">
                    <span>
                      Historie ist für dieses Flugzeug in der Flight-Line-Ansicht noch nicht
                      verfügbar. Der vollständige Audit-Verlauf steht in der Administration unter
                      Auswertung bereit.
                    </span>
                  </p>
                ) : null}
                {detailTab === "notes" ? (
                  <p className="console-info-note">
                    <span>Für dieses Flugzeug wurden noch keine Notizen hinterlegt.</span>
                  </p>
                ) : null}
              </div>
            ) : null}
            {message ? (
              <div className="action-message" role="status">
                {message}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </section>
  );
}

const rotationStatusLabel: Record<Rotation["status"], string> = {
  DRAFT: "Wartet",
  CALLED: "Aufgerufen",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
};

function SupervisorSidebarPanel({
  view,
  board,
  timeZone,
}: {
  view: Exclude<SidebarView, "fleet">;
  board: OperationBoard;
  timeZone: string;
}) {
  if (view === "groups") {
    const openRotations = board.rotations.filter((rotation) => rotation.status !== "COMPLETED");
    return (
      <section className="console-status-matrix" aria-label="Gruppen">
        <div className="console-panel-title">
          <strong>Gruppen</strong>
          <small>{openRotations.length} in der Warteschlange oder in Betreuung</small>
        </div>
        <div className="next-group-head">
          <span>Gruppe</span>
          <span>Tickets</span>
          <span>Produkt</span>
          <span>Gate</span>
          <span>Status</span>
        </div>
        {openRotations.map((rotation) => (
          <div className="console-matrix-row" key={rotation.id}>
            <strong>{rotation.communicationLabel}</strong>
            <span>{rotation.ticketCount}</span>
            <span>{rotation.productName}</span>
            <span>{rotation.gateLabel}</span>
            <span className={`console-status status-${rotation.status.toLowerCase()}`}>
              {rotationStatusLabel[rotation.status]}
            </span>
          </div>
        ))}
        {openRotations.length === 0 ? <p>Keine Gruppe wartet derzeit.</p> : null}
      </section>
    );
  }

  if (view === "refueling" || view === "maintenance") {
    const states: Aircraft["operationalState"][] =
      view === "refueling" ? ["REFUELING"] : ["INACTIVE", "INTERRUPTED"];
    const matches = board.aircraft.filter((entry) => states.includes(entry.operationalState));
    return (
      <section
        className="console-status-matrix"
        aria-label={view === "refueling" ? "Tanken" : "Wartung"}
      >
        <div className="console-panel-title">
          <strong>{view === "refueling" ? "Tanken" : "Wartung"}</strong>
          <small>{matches.length} Flugzeuge</small>
        </div>
        <div className="console-aircraft-table-head">
          <span>Flugzeug</span>
          <span>Ressource</span>
          <span>Status</span>
          <span>Seit</span>
        </div>
        {matches.map((entry) => (
          <div className="console-matrix-row" key={entry.id}>
            <strong>{entry.registration}</strong>
            <span>{entry.resourceGroupName}</span>
            <span className="console-status status-paused">{entry.operationalState}</span>
            <span>–</span>
          </div>
        ))}
        {matches.length === 0 ? (
          <p>
            {view === "refueling"
              ? "Kein Flugzeug wird derzeit betankt."
              : "Kein Flugzeug ist derzeit in Wartung oder unterbrochen."}
          </p>
        ) : null}
      </section>
    );
  }

  const recentRotations = [...board.rotations]
    .filter((rotation) => rotation.calledAt)
    .sort((a, b) => new Date(b.calledAt ?? 0).getTime() - new Date(a.calledAt ?? 0).getTime())
    .slice(0, 20);
  return (
    <section className="console-status-matrix" aria-label="Abläufe">
      <div className="console-panel-title">
        <strong>Abläufe</strong>
        <small>Letzte {recentRotations.length} aufgerufenen Gruppen</small>
      </div>
      <div className="next-group-head">
        <span>Gruppe</span>
        <span>Status</span>
        <span>Flugzeug</span>
        <span>Aufgerufen</span>
      </div>
      {recentRotations.map((rotation) => (
        <div className="console-matrix-row" key={rotation.id}>
          <strong>{rotation.communicationLabel}</strong>
          <span className={`console-status status-${rotation.status.toLowerCase()}`}>
            {rotationStatusLabel[rotation.status]}
          </span>
          <span>{rotation.aircraftRegistration ?? "–"}</span>
          <span>{formatTime(rotation.calledAt ?? null, timeZone)}</span>
        </div>
      ))}
      {recentRotations.length === 0 ? <p>Noch keine Gruppe wurde aufgerufen.</p> : null}
    </section>
  );
}
