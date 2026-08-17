// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminView } from "./admin-view";

const workspace = vi.hoisted(() => ({
  area: "overview" as "backup" | "evaluation" | "events" | "overview" | "users",
  eventStep: "event",
  board: null as Record<string, unknown> | null,
  error: null as string | null,
  refreshing: false,
}));

const actions = vi.hoisted(() => ({
  changeArea: vi.fn(),
  clearLogo: vi.fn(),
  closeCatalog: vi.fn(),
  createEvent: vi.fn(),
  emergency: vi.fn(),
  exportTemplate: vi.fn(),
  factoryResetOpen: vi.fn(),
  lockMode: vi.fn(),
  logout: vi.fn(),
  logoutAndReload: vi.fn(),
  manifestCorrection: vi.fn(),
  openCreation: vi.fn(),
  openSetupStep: vi.fn(),
  refresh: vi.fn(),
  refreshEvents: vi.fn(),
  refreshHistory: vi.fn(),
  removeEvent: vi.fn(),
  requestAdminAction: vi.fn(),
  requestDelete: vi.fn(),
  requestModeUnlock: vi.fn(),
  requestSave: vi.fn(),
  runBusyAction: vi.fn(),
  saveEventParameters: vi.fn(),
  saveLogo: vi.fn(),
  selectResource: vi.fn(),
  setLifecycle: vi.fn(),
  startNew: vi.fn(),
  templateOpen: vi.fn(),
}));

const captures = vi.hoisted(() => ({
  dialogs: null as Record<string, unknown> | null,
  eventCatalog: null as Record<string, unknown> | null,
  masterWorkspace: null as Record<string, unknown> | null,
  operations: null as Record<string, unknown> | null,
}));

const editor = {
  dirty: false,
  selectedId: "new",
};

vi.mock("./features/auth/AuthContext", () => ({
  useAuth: () => ({
    logout: actions.logout,
    session: {
      account: {
        id: "00000000-0000-4000-8000-000000000001",
        loginCode: "ADMIN-01",
        role: "ADMIN",
      },
    },
  }),
}));

vi.mock("./operation-workspace", () => ({
  ConnectionNotice: ({ error }: { error: string | null }) =>
    error ? <p>Verbindungsfehler: {error}</p> : null,
  EmergencyNotice: ({ active }: { active: boolean }) => (active ? <p>Notfall aktiv</p> : null),
  InterruptionNotice: ({ active }: { active: boolean }) =>
    active ? <p>Betrieb unterbrochen</p> : null,
  OperationalNotice: ({ note }: { note?: string | null }) => (note ? <p>{note}</p> : null),
  useOperationBoard: () => ({
    backendConfirmed: true,
    board: workspace.board,
    error: workspace.error,
    lastConfirmedAt: "2026-08-13T09:00:00.000Z",
    refresh: actions.refresh,
    refreshing: workspace.refreshing,
  }),
  useOperationIdentity: () => ({ eventId: "demo-event" }),
}));

vi.mock("./app/AppShell", () => ({
  AppShell: ({
    children,
    notifications,
    title,
  }: {
    children: ReactNode;
    notifications: ReactNode;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      {notifications}
      {children}
    </main>
  ),
}));

vi.mock("./app/PageNotifications", () => ({
  PageNotice: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  useActionMessageBridge: vi.fn(),
}));

vi.mock("./admin-ux", () => ({
  AdminNavigation: ({ onChange }: { onChange: (area: string) => void }) => (
    <button onClick={() => onChange("users")} type="button">
      Benutzer öffnen
    </button>
  ),
  SetupProgress: ({ onSelect }: { onSelect: (step: { category: string; id: string }) => void }) => (
    <button onClick={() => onSelect({ category: "aircraft", id: "aircraft" })} type="button">
      Flugzeuge öffnen
    </button>
  ),
  ValidationHint: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("./design-system/components", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
  PageHeader: ({
    actions: headerActions,
    description,
    title,
  }: {
    actions: ReactNode;
    description: string;
    title: string;
  }) => (
    <header>
      <h2>{title}</h2>
      <p>{description}</p>
      {headerActions}
    </header>
  ),
  StatusPill: ({ children }: { children: ReactNode }) => <strong>{children}</strong>,
}));

vi.mock("./features/admin/admin-shell-model", () => ({
  adminAreaCopy: {
    backup: { description: "Backup-Beschreibung", title: "Backup" },
    evaluation: { description: "Auswertung-Beschreibung", title: "Auswertung" },
    overview: { description: "Übersicht-Beschreibung", title: "Übersicht" },
    users: { description: "Benutzer-Beschreibung", title: "Benutzer" },
  },
  adminEventStepCopy: {
    aircraft: { description: "Flugzeuge-Beschreibung", title: "Flugzeuge" },
    completion: { description: "Abschluss-Beschreibung", title: "Abschluss" },
    event: { description: "Veranstaltung-Beschreibung", title: "Veranstaltung" },
    operations: { description: "Betrieb-Beschreibung", title: "Betrieb" },
    "operational-plan": { description: "Plan-Beschreibung", title: "Planung" },
  },
  createAdminSetupSteps: () => [{ category: "aircraft", complete: true, id: "aircraft" }],
  summarizeAdminSetup: () => ({ complete: true, completedSteps: ["aircraft"] }),
}));

vi.mock("./features/admin/event-workspace/useAdminEventWorkspaceNavigation", () => ({
  useAdminEventWorkspaceNavigation: () => ({
    adminArea: workspace.area,
    adminWorkspaceScrollRef: { current: null },
    cancelPendingNavigation: vi.fn(),
    changeAdminArea: actions.changeArea,
    confirmPendingNavigation: vi.fn(),
    discardEventNavigationOpen: false,
    eventParametersResetKey: 0,
    eventStep: workspace.eventStep,
    openSetupStep: actions.openSetupStep,
    setEventParametersDirty: vi.fn(),
  }),
}));

vi.mock("./features/admin/useAdminShellState", () => ({
  useAdminShellState: () => ({
    busyActionKey: null,
    logoutAndReload: actions.logoutAndReload,
    logoutBusy: false,
    pushConfigurationStatus: "configured",
    runBusyAction: actions.runBusyAction,
    setupRequired: !workspace.board,
  }),
}));

vi.mock("./features/admin/useAdminAuthorization", () => ({
  useAdminAuthorization: () => ({
    clearPinWhenLocked: vi.fn(),
    getPin: () => "123456",
    lockMode: actions.lockMode,
    modeUnlocked: true,
    requestAction: actions.requestAdminAction,
    requestModeUnlock: actions.requestModeUnlock,
    setPin: vi.fn(),
  }),
}));

vi.mock("./features/admin/completion/useAdminHistory", () => ({
  useAdminHistory: () => ({ refreshAuditHistory: actions.refreshHistory }),
}));

vi.mock("./features/admin/event-parameters/useAdminEventConfigurationActions", () => ({
  useAdminEventConfigurationActions: () => ({
    requestClearEventLogo: actions.clearLogo,
    requestSaveEventLogo: actions.saveLogo,
    requestSaveEventParameters: actions.saveEventParameters,
    setEventLifecycle: actions.setLifecycle,
  }),
}));

vi.mock("./features/admin/event-workspace/useAdminEventCatalog", () => ({
  useAdminEventCatalog: () => ({
    closeDialog: actions.closeCatalog,
    createEvent: actions.createEvent,
    creation: {},
    exportTemplate: actions.exportTemplate,
    openCreation: actions.openCreation,
    refreshEvents: actions.refreshEvents,
    removeEvent: actions.removeEvent,
    search: "",
    setAerodrome: vi.fn(),
    setEventDate: vi.fn(),
    setEventId: vi.fn(),
    setName: vi.fn(),
    setRestartMode: vi.fn(),
    setSearch: vi.fn(),
    showCatalog: vi.fn(),
    sort: "date",
    toggleSort: vi.fn(),
    view: "catalog",
    visibleEvents: [{ eventId: "archive-event" }],
  }),
}));

vi.mock("./features/admin/master-data/useAdminMasterDataTable", () => ({
  useAdminMasterDataTable: () => ({
    alphabeticalProducts: workspace.board ? (workspace.board.products as unknown[]) : [],
    setSearch: vi.fn(),
    totalCount: workspace.board ? 1 : 0,
  }),
}));

vi.mock("./features/admin/master-data/useAdminMasterEditorState", () => ({
  useAdminMasterEditorState: () => ({
    finish: vi.fn(),
    requestClose: vi.fn(),
    resetForStepChange: vi.fn(),
    selectAircraft: vi.fn(),
    selectGate: vi.fn(),
    selectPilot: vi.fn(),
    selectProduct: vi.fn(),
    selectResourceGroup: actions.selectResource,
    setOpen: vi.fn(),
    setSubmitAttempted: vi.fn(),
    startNewEntry: actions.startNew,
  }),
}));

vi.mock("./features/admin/master-data/useAdminMasterDataActions", () => ({
  useAdminMasterDataActions: () => ({
    emergency: actions.emergency,
    requestCurrentMasterSave: actions.requestSave,
    requestManifestCorrection: actions.manifestCorrection,
  }),
}));

vi.mock("./features/admin/master-data/useAdminMasterDataDeletion", () => ({
  useAdminMasterDataDeletion: () => ({ requestDeletion: actions.requestDelete }),
}));

vi.mock("./features/admin/master-data/useMasterDataTemplateImport", () => ({
  useMasterDataTemplateImport: () => ({ openDialog: actions.templateOpen }),
}));

vi.mock("./features/admin/master-data/AdminMasterEditorActions", () => ({
  AdminMasterEditorFooter: ({
    onDelete,
    onSave,
  }: {
    onDelete: (action: Record<string, string>) => void;
    onSave: () => void;
  }) => (
    <div>
      <button onClick={onSave} type="button">
        Editor speichern
      </button>
      <button
        onClick={() =>
          onDelete({ entityId: "aircraft-1", entityType: "aircraft", label: "D-TEST" })
        }
        type="button"
      >
        Editor löschen
      </button>
    </div>
  ),
  AdminMasterEditorFurtherActions: () => null,
  getAdminMasterEditorPresentation: () => ({
    busyKey: "save-aircraft",
    deleteAction: { entityId: "aircraft-1", entityType: "aircraft", label: "D-TEST" },
    emptyDescription: "Keine Einträge vorhanden",
    emptyTitle: "Noch leer",
  }),
}));

vi.mock("./features/admin/master-data/MasterDataWorkspace", () => ({
  MasterDataEmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));

vi.mock("./features/admin/aircraft/useAircraftEditorState", () => ({
  useAircraftEditorState: () => editor,
}));

vi.mock("./features/admin/gates/useGateEditorState", () => ({
  useGateEditorState: () => editor,
}));

vi.mock("./features/admin/pilots/usePilotEditorState", () => ({
  usePilotEditorState: () => editor,
}));

vi.mock("./features/admin/products/useProductEditorState", () => ({
  useProductEditorState: () => editor,
}));

vi.mock("./features/admin/resource-groups/useResourceGroupEditorState", () => ({
  useResourceGroupEditorState: () => ({ ...editor, select: actions.selectResource }),
}));

vi.mock("./features/admin/overview/useAdminEventFlow", () => ({
  useAdminEventFlow: () => ({ error: null, flow: [], loading: false }),
}));

vi.mock("./features/admin/useAdminFactoryReset", () => ({
  useAdminFactoryReset: () => ({ openDialog: actions.factoryResetOpen }),
}));

vi.mock("./features/admin/overview/AdminAccessStatusBar", () => ({
  AdminAccessStatusBar: ({
    onLockAdminMode,
    onLogout,
    onRefresh,
    onRequestAdminModeUnlock,
  }: Record<string, () => void>) => (
    <div>
      <button onClick={onRefresh} type="button">
        Aktualisieren
      </button>
      <button onClick={onLockAdminMode} type="button">
        Sperren
      </button>
      <button onClick={onRequestAdminModeUnlock} type="button">
        Entsperren
      </button>
      <button onClick={onLogout} type="button">
        Abmelden
      </button>
    </div>
  ),
}));

vi.mock("./features/admin/overview/AdminOverviewPanel", () => ({
  AdminOverviewPanel: () => <section>Übersichtsinhalt</section>,
}));

vi.mock("./features/admin/overview/AdminSimulationLauncher", () => ({
  AdminSimulationLauncher: () => <button type="button">Simulation</button>,
}));

vi.mock("./features/admin/AdminShellDialogs", () => ({
  AdminShellDialogs: (props: Record<string, unknown>) => {
    captures.dialogs = props;
    return <aside>{props.editorFooter as ReactNode}</aside>;
  },
}));

vi.mock("./features/admin/admin-lazy-components", () => ({
  AccountManagement: () => <section>Benutzerverwaltung</section>,
  AdminCompletionWorkspacePanel: ({
    onRequestManifestCorrection,
  }: {
    onRequestManifestCorrection: () => void;
  }) => (
    <button onClick={onRequestManifestCorrection} type="button">
      Manifest korrigieren
    </button>
  ),
  AdminMasterDataWorkspacePanel: (props: Record<string, unknown>) => {
    captures.masterWorkspace = props;
    return <section>Stammdaten-Arbeitsbereich</section>;
  },
  AdminOperationalPlanPanel: ({ onRefresh }: { onRefresh: () => void }) => (
    <button onClick={onRefresh} type="button">
      Plan aktualisieren
    </button>
  ),
  AdminOperationsPanel: (props: Record<string, unknown>) => {
    captures.operations = props;
    return <section>Betriebs-Arbeitsbereich</section>;
  },
  AdminWorkspaceLoading: () => <p>Lädt</p>,
  AnalysisWorkspace: ({ simulator }: { simulator: ReactNode }) => (
    <section>Analyse {simulator}</section>
  ),
  EventCatalogDialog: (props: Record<string, unknown>) => {
    captures.eventCatalog = props;
    return <section>Veranstaltungskatalog</section>;
  },
  EventParametersWorkspace: () => <section>Veranstaltungsparameter</section>,
}));

function createBoard() {
  return {
    aircraft: [{ id: "aircraft-1", registration: "D-TEST" }],
    currentDeviceRole: "ADMIN",
    event: {
      emergencyMode: false,
      eventId: "demo-event",
      name: "Synthetischer Flugtag",
      operationalInterrupted: false,
      operationalNote: null,
      status: "ACTIVE",
      timeZone: "Europe/Berlin",
      version: 4,
    },
    gates: [],
    pilots: [],
    products: [
      {
        id: "product-1",
        name: "Rundflug",
        saleClosesAt: "2026-08-13T12:30:00.000Z",
      },
    ],
    resourceGroups: [{ id: "resource-1", name: "Gruppe 1" }],
  };
}

describe("admin view orchestration", () => {
  beforeEach(() => {
    workspace.area = "overview";
    workspace.eventStep = "event";
    workspace.board = createBoard();
    workspace.error = null;
    workspace.refreshing = false;
    captures.dialogs = null;
    captures.eventCatalog = null;
    captures.masterWorkspace = null;
    captures.operations = null;
    vi.clearAllMocks();
    actions.runBusyAction.mockImplementation(async (_key: string, callback: () => unknown) =>
      callback(),
    );
  });

  afterEach(() => cleanup());

  it("coordinates overview access actions and active status", async () => {
    const user = userEvent.setup();
    render(<AdminView />);

    expect(screen.getByText("Übersichtsinhalt")).toBeTruthy();
    expect(screen.getByText("Betrieb aktiv")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
    await user.click(screen.getByRole("button", { name: "Sperren" }));
    await user.click(screen.getByRole("button", { name: "Entsperren" }));
    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    await user.click(screen.getByRole("button", { name: "Benutzer öffnen" }));

    expect(actions.refresh).toHaveBeenCalledOnce();
    expect(actions.lockMode).toHaveBeenCalledOnce();
    expect(actions.requestModeUnlock).toHaveBeenCalledOnce();
    expect(actions.logoutAndReload).toHaveBeenCalledOnce();
    expect(actions.changeArea).toHaveBeenCalledWith("users");
  });

  it.each([
    ["PREPARATION", "Betrieb noch nicht freigegeben"],
    ["CLOSED", "Betrieb geschlossen"],
  ])("presents the %s event status", (status, label) => {
    const board = createBoard();
    workspace.board = { ...board, event: { ...board.event, status } };

    render(<AdminView />);

    expect(screen.getByText(label)).toBeTruthy();
  });

  it("presents a loading status before the board is available", () => {
    workspace.board = null;

    render(<AdminView />);

    expect(screen.getByText("Stand wird geladen")).toBeTruthy();
  });

  it("surfaces setup and connection states when no board is available", () => {
    workspace.board = null;
    workspace.error = "Backend nicht erreichbar";
    render(<AdminView />);

    expect(screen.getByText(/noch nicht eingerichtet/)).toBeTruthy();
    expect(screen.getByText("Verbindungsfehler: Backend nicht erreichbar")).toBeTruthy();
    expect(screen.getByText("Stand nicht verfügbar")).toBeTruthy();
    expect(screen.queryByText("Übersichtsinhalt")).toBeNull();
  });

  it("connects event catalog and aircraft master-data workflows", async () => {
    const user = userEvent.setup();
    workspace.area = "events";
    workspace.eventStep = "aircraft";
    render(<AdminView />);

    expect(screen.getByText("Veranstaltungskatalog")).toBeTruthy();
    expect(screen.getByText("Stammdaten-Arbeitsbereich")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Veranstaltungen verwalten" }));
    await user.click(screen.getByRole("button", { name: "Flugzeuge öffnen" }));
    await user.click(screen.getByRole("button", { name: "Editor speichern" }));
    await user.click(screen.getByRole("button", { name: "Editor löschen" }));

    expect(actions.openSetupStep).toHaveBeenCalledWith({ category: "aircraft", id: "aircraft" });
    expect(actions.requestSave).toHaveBeenCalledOnce();
    expect(actions.requestDelete).toHaveBeenCalledWith("aircraft", "aircraft-1", "D-TEST");

    const catalog = captures.eventCatalog as {
      onCreateSubmit: () => unknown;
      onDelete: (entry: { eventId: string }) => unknown;
      onExport: () => unknown;
      onImport: () => unknown;
    };
    await catalog.onCreateSubmit();
    await catalog.onDelete({ eventId: "archive-event" });
    await catalog.onExport();
    catalog.onImport();
    expect(actions.runBusyAction).toHaveBeenCalledWith("create-event", actions.createEvent);
    expect(actions.runBusyAction).toHaveBeenCalledWith(
      "export-master-data-template",
      actions.exportTemplate,
    );
    expect(actions.removeEvent).toHaveBeenCalledWith({ eventId: "archive-event" });
    expect(actions.templateOpen).toHaveBeenCalledOnce();

    const master = captures.masterWorkspace as {
      onNew: () => unknown;
      onOpenSales: (productId: string) => unknown;
    };
    master.onNew();
    master.onOpenSales("missing-product");
    master.onOpenSales("product-1");
    await waitFor(() =>
      expect(captures.dialogs).toEqual(expect.objectContaining({ salesProductId: "product-1" })),
    );
    expect(actions.startNew).toHaveBeenCalledOnce();
  });

  it("coordinates operational emergency and completion actions", async () => {
    const user = userEvent.setup();
    workspace.area = "events";
    workspace.eventStep = "operations";
    actions.emergency.mockResolvedValue(true);
    render(<AdminView />);

    expect(screen.getByText("Betriebs-Arbeitsbereich")).toBeTruthy();
    const operations = captures.operations as {
      onEmergency: (
        action: "CLEAR_EMERGENCY" | "TRIGGER_EMERGENCY",
        reason: string,
      ) => Promise<boolean>;
    };
    await expect(operations.onEmergency("TRIGGER_EMERGENCY", "synthetic reason")).resolves.toBe(
      true,
    );
    await expect(operations.onEmergency("CLEAR_EMERGENCY", "")).resolves.toBe(true);
    expect(actions.runBusyAction).toHaveBeenCalledWith("emergency-trigger", expect.any(Function));
    expect(actions.runBusyAction).toHaveBeenCalledWith("emergency-clear", expect.any(Function));

    cleanup();
    workspace.eventStep = "completion";
    render(<AdminView />);
    await user.click(screen.getByRole("button", { name: "Manifest korrigieren" }));
    expect(actions.manifestCorrection).toHaveBeenCalledOnce();
  });

  it("renders evaluation, planning, users, and backup workspaces", async () => {
    const user = userEvent.setup();
    workspace.area = "evaluation";
    const { rerender } = render(<AdminView />);
    expect(screen.getByText(/Analyse/)).toBeTruthy();

    workspace.area = "events";
    workspace.eventStep = "operational-plan";
    rerender(<AdminView />);
    await user.click(screen.getByRole("button", { name: "Plan aktualisieren" }));
    expect(actions.refresh).toHaveBeenCalledOnce();

    workspace.area = "users";
    rerender(<AdminView />);
    expect(screen.getByText("Benutzerverwaltung")).toBeTruthy();

    workspace.area = "backup";
    rerender(<AdminView />);
    await user.click(screen.getByRole("button", { name: "Werkszustand vorbereiten" }));
    expect(actions.factoryResetOpen).toHaveBeenCalledOnce();
  });
});
