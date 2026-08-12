import type { EventCatalogEntry, OperatorSession } from "@rundflug/contracts";
import { lazy, Suspense, useEffect, useState } from "react";
import { homeForRole, mayOpenEventRoute } from "../../app/navigation";
import { ActiveEventProvider, rememberActiveEvent, resolveActiveEvent } from "../../event-context";
import { eventSelectionLocation } from "../../event-navigation";
import { loadSelectableEvents } from "./api";
import { EventSelectionPage } from "./EventSelectionPage";

const FeatureRouter = lazy(async () => {
  const module = await import("../../FeatureRouter");
  return { default: module.FeatureRouter };
});

function Loading({ children = "Arbeitsbereich wird geladen …" }: { children?: string }) {
  return (
    <div className="app-loading" role="status">
      {children}
    </div>
  );
}

export function EventScopedApplication({ session }: { session: OperatorSession }) {
  const [events, setEvents] = useState<EventCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activatedEventId, setActivatedEventId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadSelectableEvents()
      .then((catalog) => {
        if (active) setEvents(catalog.events);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Veranstaltungen nicht verfügbar.");
      });
    return () => {
      active = false;
    };
  }, []);
  const requestedEventId = events
    ? resolveActiveEvent(window.location.search, window.localStorage)
    : "";
  const selectedEvent = events?.find((entry) => entry.eventId === requestedEventId);
  const selectedEventId = selectedEvent?.eventId;
  const selectedEventName = selectedEvent?.name;
  useEffect(() => {
    if (!selectedEventId) return;

    rememberActiveEvent(window.localStorage, selectedEventId, selectedEventName);
    if (new URLSearchParams(window.location.search).has("event")) {
      window.history.replaceState(null, "", eventSelectionLocation(window.location.href));
    }
    setActivatedEventId(selectedEventId);
  }, [selectedEventId, selectedEventName]);
  if (error)
    return (
      <div className="app-loading" role="alert">
        {error}
      </div>
    );
  if (!events) return <Loading />;
  if (!selectedEvent) return <EventSelectionPage events={events} session={session} />;
  if (activatedEventId !== selectedEvent.eventId) return <Loading />;
  if (
    window.location.pathname === "/fids/terminal" ||
    new URLSearchParams(window.location.search).get("style") === "terminal"
  ) {
    const normalized = new URL(window.location.href);
    normalized.pathname = "/fids";
    normalized.searchParams.delete("style");
    window.history.replaceState(
      null,
      "",
      `${normalized.pathname}${normalized.search}${normalized.hash}`,
    );
  }
  if (window.location.pathname === "/") {
    window.location.replace(homeForRole(session.account.role));
    return <Loading>Arbeitsbereich wird geöffnet …</Loading>;
  }
  const permitted = mayOpenEventRoute(session.account.role, window.location.pathname);
  if (!permitted) {
    window.location.replace(homeForRole(session.account.role));
    return <Loading>Arbeitsbereich wird geöffnet …</Loading>;
  }
  return (
    <ActiveEventProvider eventId={selectedEvent.eventId} eventName={selectedEvent.name}>
      <Suspense fallback={<Loading />}>
        <FeatureRouter />
      </Suspense>
    </ActiveEventProvider>
  );
}
