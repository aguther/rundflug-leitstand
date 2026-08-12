// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApiCommandError,
  acquireDispatchRecommendationLease,
  bootstrapSystem,
  claimFlightLineAircraft,
  cloneEvent,
  createAnalysisArchive,
  deleteAnalysisArchive,
  deleteEvent,
  downloadAnalysisArchive,
  downloadDailyPdf,
  downloadDailyReport,
  downloadMasterDataTemplate,
  downloadSimulationPlan,
  downloadTicketRawData,
  factoryReset,
  getAdminEventFlow,
  getAuditHistory,
  getDemoSnapshot,
  getEventCatalog,
  getFidsBoard,
  getFidsFilterOptions,
  getFidsPreferences,
  getForecastHistory,
  getHealth,
  getOperationalHistory,
  getOperationBoard,
  getPublicBoard,
  getPublicGroupStatus,
  getPublicTicketStatus,
  getPushConfiguration,
  getPushPublicKey,
  getResourceDayHistory,
  getSetupStatus,
  getTicketGroupPrintData,
  importMasterDataTemplate,
  listAnalysisArchives,
  registerGroupPush,
  registerTicketPush,
  releaseDispatchRecommendationLease,
  releaseFlightLineAircraft,
  removeEventLogo,
  revokeGroupPush,
  revokeTicketPush,
  searchTickets,
  sendCommand,
  updateFidsPreferences,
  uploadEventLogo,
  validateMasterDataTemplate,
  verifyAdminPin,
} from "./api";

const EVENT_ID = "synthetic event";
const DEVICE_ID = "ignored-device";
const DEVICE_TOKEN = "ignored-token";

function jsonResponse(body: unknown, status = 503): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rejection(body: unknown = {}, status = 503): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => "550e8400-e29b-41d4-a716-446655440001"),
  });
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("API transport failure boundaries", () => {
  it("preserves abort errors without replacing them with connectivity guidance", async () => {
    const aborted = new DOMException("synthetic abort", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));

    await expect(getHealth()).rejects.toBe(aborted);
  });

  it("converts failed and aborted XHR fallbacks into the appropriate error", async () => {
    class FailingXmlHttpRequest {
      private readonly listeners = new Map<string, () => void>();
      withCredentials = false;

      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, listener);
      }
      send() {
        this.listeners.get("error")?.();
      }
      abort() {
        this.listeners.get("abort")?.();
      }
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("synthetic fetch failure")));
    vi.stubGlobal("XMLHttpRequest", FailingXmlHttpRequest);

    await expect(getHealth()).rejects.toThrowError(
      "Server nicht erreichbar. Bitte Verbindung prüfen und die Seite neu laden.",
    );

    class AbortedXmlHttpRequest extends FailingXmlHttpRequest {
      override send() {
        this.abort();
      }
    }
    vi.stubGlobal("XMLHttpRequest", AbortedXmlHttpRequest);
    await expect(getHealth()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps successful requests independent from unsupported timing diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    vi.spyOn(performance, "measure").mockImplementation(() => {
      throw new Error("synthetic legacy browser");
    });

    await expect(getOperationBoard(EVENT_ID, DEVICE_ID, DEVICE_TOKEN)).rejects.toThrowError(
      "Betriebsdaten nicht verfügbar (503)",
    );
  });
});

describe("API endpoint error contracts", () => {
  const unavailableCases: Array<{
    name: string;
    invoke: () => Promise<unknown>;
    message: string;
  }> = [
    {
      name: "setup status",
      invoke: () => getSetupStatus(),
      message: "Einrichtungsstatus ist nicht verfügbar.",
    },
    {
      name: "ticket search",
      invoke: () => searchTickets(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, "query"),
      message: "Ticketsuche nicht verfügbar.",
    },
    {
      name: "ticket print data",
      invoke: () => getTicketGroupPrintData(EVENT_ID, "group/1", DEVICE_ID, DEVICE_TOKEN),
      message: "Ticketzettel konnten nicht geladen werden.",
    },
    {
      name: "event catalog",
      invoke: () => getEventCatalog(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Veranstaltungsliste nicht verfügbar.",
    },
    {
      name: "admin event flow",
      invoke: () =>
        getAdminEventFlow(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, new AbortController().signal),
      message: "Ticketverlauf nicht verfügbar.",
    },
    {
      name: "master-data template",
      invoke: () => downloadMasterDataTemplate(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Stammdatenvorlage nicht verfügbar.",
    },
    {
      name: "simulation plan",
      invoke: () => downloadSimulationPlan(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Simulationsgrundlage nicht verfügbar.",
    },
    {
      name: "audit history",
      invoke: () =>
        getAuditHistory(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
          eventType: "MARK_LANDED",
          aggregateType: "ROTATION",
          aggregateId: "rotation-1",
          since: "2026-07-24T08:00:00.000Z",
          until: "2026-07-24T09:00:00.000Z",
        }),
      message: "Audit-Historie nicht verfügbar.",
    },
    {
      name: "operational history",
      invoke: () =>
        getOperationalHistory(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
          since: "2026-07-24T08:00:00.000Z",
          limit: 20,
        }),
      message: "Betriebshistorie nicht verfügbar.",
    },
    {
      name: "forecast history",
      invoke: () => getForecastHistory(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {}),
      message: "Prognosehistorie nicht verfügbar.",
    },
    {
      name: "resource history",
      invoke: () =>
        getResourceDayHistory(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
          scopeType: "AIRCRAFT",
          scopeId: "aircraft-1",
        }),
      message: "Tagesverlauf nicht verfügbar.",
    },
    {
      name: "daily report",
      invoke: () => downloadDailyReport(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Tagesbericht nicht verfügbar.",
    },
    {
      name: "protected export",
      invoke: () => downloadDailyPdf(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Export nicht verfügbar.",
    },
    {
      name: "second protected export",
      invoke: () => downloadTicketRawData(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      message: "Export nicht verfügbar.",
    },
    {
      name: "public board",
      invoke: () => getPublicBoard(EVENT_ID, "gate/1", new AbortController().signal),
      message: "Öffentliche Anzeige nicht verfügbar.",
    },
    {
      name: "FIDS filter options",
      invoke: () => getFidsFilterOptions(EVENT_ID),
      message: "FIDS-Filteroptionen nicht verfügbar.",
    },
    {
      name: "public ticket",
      invoke: () => getPublicTicketStatus("ticket/1", new AbortController().signal),
      message: "Ticket nicht gefunden.",
    },
    {
      name: "public group",
      invoke: () => getPublicGroupStatus("group/1", new AbortController().signal),
      message: "Gruppe nicht gefunden.",
    },
    {
      name: "ticket push registration",
      invoke: () => registerTicketPush("ticket/1", { toJSON: () => ({}) } as PushSubscription),
      message: "Web-Push konnte nicht aktiviert werden.",
    },
    {
      name: "ticket push revocation",
      invoke: () => revokeTicketPush("ticket/1", "https://push.synthetic/endpoint"),
      message: "Web-Push konnte nicht deaktiviert werden.",
    },
    {
      name: "group push registration",
      invoke: () => registerGroupPush("group/1", { toJSON: () => ({}) } as PushSubscription),
      message: "Web-Push konnte nicht aktiviert werden.",
    },
    {
      name: "group push revocation",
      invoke: () => revokeGroupPush("group/1", "https://push.synthetic/endpoint"),
      message: "Web-Push konnte nicht deaktiviert werden.",
    },
    {
      name: "health",
      invoke: () => getHealth(new AbortController().signal),
      message: "Healthcheck fehlgeschlagen (503)",
    },
    {
      name: "demo snapshot",
      invoke: () => getDemoSnapshot(new AbortController().signal),
      message: "Demo-Snapshot nicht verfügbar (503)",
    },
  ];

  it.each(unavailableCases)("reports the stable $name fallback", async ({ invoke, message }) => {
    rejection();
    await expect(invoke()).rejects.toThrowError(message);
  });

  it("preserves server validation messages across administrative mutations", async () => {
    const serverMessage = "Synthetic server validation";
    const cases: Array<() => Promise<unknown>> = [
      () => verifyAdminPin(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, "0000"),
      () => releaseFlightLineAircraft(EVENT_ID, "aircraft-1", DEVICE_ID, DEVICE_TOKEN),
      () => validateMasterDataTemplate(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {} as never),
      () => importMasterDataTemplate(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {} as never),
      () => cloneEvent(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {} as never),
      () => deleteEvent(EVENT_ID, "delete-event", 4, DEVICE_ID, DEVICE_TOKEN, "Synthetic cleanup"),
      () =>
        uploadEventLogo(
          EVENT_ID,
          DEVICE_ID,
          DEVICE_TOKEN,
          4,
          "light",
          new File(["logo"], "logo.svg", { type: "image/svg+xml" }),
        ),
      () => removeEventLogo(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, 4, "dark"),
      () => factoryReset(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {} as never),
      () => getFidsPreferences(EVENT_ID),
      () => updateFidsPreferences(EVENT_ID, {} as never),
      () => getFidsBoard(EVENT_ID, { page: 1, lowerPage: 0 }, new AbortController().signal),
      () => listAnalysisArchives(EVENT_ID, DEVICE_ID, DEVICE_TOKEN),
      () => createAnalysisArchive(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, 4),
      () =>
        downloadAnalysisArchive(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
          id: "archive/1",
          eventVersion: 4,
        } as never),
      () => deleteAnalysisArchive(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, "archive/1"),
    ];

    for (const invoke of cases) {
      rejection({ error: { message: serverMessage } }, 400);
      await expect(invoke()).rejects.toThrowError(serverMessage);
    }
  });

  it("uses stable fallbacks for malformed mutation errors", async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        () => claimFlightLineAircraft(EVENT_ID, "aircraft-1", DEVICE_ID, DEVICE_TOKEN),
        "Betreuung konnte nicht übernommen werden.",
      ],
      [
        () => releaseDispatchRecommendationLease(EVENT_ID, "lease-1", DEVICE_ID, DEVICE_TOKEN),
        "Belegungsvorschlag konnte nicht freigegeben werden.",
      ],
      [() => bootstrapSystem({} as never), "Ersteinrichtung fehlgeschlagen."],
      [
        () => cloneEvent(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {} as never),
        "Veranstaltung konnte nicht angelegt werden.",
      ],
      [
        () =>
          deleteEvent(EVENT_ID, "delete-event", 4, DEVICE_ID, DEVICE_TOKEN, "Synthetic cleanup"),
        "Veranstaltung konnte nicht gelöscht werden.",
      ],
      [
        () =>
          uploadEventLogo(
            EVENT_ID,
            DEVICE_ID,
            DEVICE_TOKEN,
            4,
            "light",
            new File(["logo"], "logo.svg", { type: "image/svg+xml" }),
          ),
        "Veranstaltungslogo konnte nicht gespeichert werden.",
      ],
    ];

    for (const [invoke, message] of cases) {
      rejection();
      await expect(invoke()).rejects.toThrowError(message);
    }
  });

  it("preserves structured dispatch lease conflicts and fallback codes", async () => {
    rejection(
      {
        error: {
          code: "STALE_VERSION",
          message: "Synthetic stale lease",
          currentVersion: 9,
        },
      },
      409,
    );
    await expect(
      acquireDispatchRecommendationLease(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
        commandId: "550e8400-e29b-41d4-a716-446655440001",
        aircraftId: "aircraft-1",
        expectedVersion: 8,
      }),
    ).rejects.toMatchObject({
      code: "STALE_VERSION",
      status: 409,
      currentVersion: 9,
    } satisfies Partial<ApiCommandError>);

    rejection({}, 500);
    await expect(
      acquireDispatchRecommendationLease(EVENT_ID, DEVICE_ID, DEVICE_TOKEN, {
        commandId: "550e8400-e29b-41d4-a716-446655440002",
        aircraftId: "aircraft-1",
        expectedVersion: 8,
      }),
    ).rejects.toMatchObject({
      code: "DISPATCH_RECOMMENDATION_LEASE_REJECTED",
      status: 500,
    } satisfies Partial<ApiCommandError>);
  });

  it("rejects successful-looking claims not owned by the current operator", async () => {
    rejection(
      {
        aircraftId: "aircraft-1",
        claimedByCurrentOperator: false,
        ownerLoginCode: "FL-SYNTHETIC",
        revision: 2,
        claimedAt: "2026-08-11T09:00:00.000Z",
        expiresAt: "2026-08-11T09:05:00.000Z",
      },
      200,
    );

    await expect(
      claimFlightLineAircraft(EVENT_ID, "aircraft-1", DEVICE_ID, DEVICE_TOKEN),
    ).rejects.toThrowError("Betreuung wurde nicht dem aktuellen Login zugeordnet.");
  });

  it("rejects unavailable and incomplete push configuration", async () => {
    rejection({}, 500);
    await expect(getPushConfiguration()).rejects.toThrowError(
      "Web-Push-Konfiguration ist nicht erreichbar.",
    );

    rejection({ publicKey: "too-short", retentionDays: 7 }, 200);
    await expect(getPushConfiguration()).rejects.toThrowError(
      "Web-Push-Konfiguration ist unvollständig.",
    );

    rejection({}, 503);
    await expect(getPushPublicKey()).rejects.toThrowError("Web-Push ist noch nicht eingerichtet.");
  });

  it("uses the stable command fallback when the error payload is not structured", async () => {
    rejection({}, 418);

    await expect(
      sendCommand(
        {
          commandId: "550e8400-e29b-41d4-a716-446655440001",
          eventId: EVENT_ID,
          deviceId: DEVICE_ID,
          expectedVersion: 4,
          issuedAt: "2026-07-24T08:00:00.000Z",
          type: "SET_OPERATIONAL_NOTE",
          payload: { note: "Synthetic note" },
        },
        DEVICE_TOKEN,
      ),
    ).rejects.toMatchObject({
      code: "COMMAND_REJECTED",
      status: 418,
      message: "Kommando abgelehnt (418)",
    } satisfies Partial<ApiCommandError>);
  });
});
