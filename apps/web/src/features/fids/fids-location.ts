import { parseFidsPage } from "@rundflug/domain";

export interface FidsLocationAdapter {
  getPage(): number;
  setPage(page: number): void;
  isSetupMode(): boolean;
  setSetupMode(active: boolean): void;
  getShareableUrl(): string;
  subscribe(listener: () => void): () => void;
}

const LOCATION_EVENT = "fids-location-change";
export function createFidsLocationAdapter(target: Window): FidsLocationAdapter {
  const currentUrl = () => new URL(target.location.href);
  const update = (mutate: (url: URL) => void) => {
    const url = currentUrl();
    mutate(url);
    target.history.pushState(null, "", url);
    target.dispatchEvent(new Event(LOCATION_EVENT));
  };
  return {
    getPage: () => parseFidsPage(currentUrl().searchParams.get("page")),
    setPage: (page) =>
      update((url) => {
        url.searchParams.set("page", String(Math.max(1, Math.min(999, Math.trunc(page)))));
      }),
    isSetupMode: () => currentUrl().searchParams.get("setup") === "1",
    setSetupMode: (active) =>
      update((url) => {
        if (active) url.searchParams.set("setup", "1");
        else url.searchParams.delete("setup");
      }),
    getShareableUrl: () => {
      const current = currentUrl();
      const shareable = new URL(current.pathname, current.origin);
      const eventId = current.searchParams.get("event");
      if (eventId) shareable.searchParams.set("event", eventId);
      shareable.searchParams.set("page", String(parseFidsPage(current.searchParams.get("page"))));
      return shareable.toString();
    },
    subscribe: (listener) => {
      target.addEventListener("popstate", listener);
      target.addEventListener(LOCATION_EVENT, listener);
      return () => {
        target.removeEventListener("popstate", listener);
        target.removeEventListener(LOCATION_EVENT, listener);
      };
    },
  };
}
