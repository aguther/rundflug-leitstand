import { forgetActiveEvent } from "./event-context";

export function eventSelectionLocation(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("event");

  return `${url.pathname}${url.search}${url.hash}`;
}

export function reloadAtEventSelectionLocation(
  location: Pick<Location, "href" | "reload">,
  history: Pick<History, "replaceState">,
): void {
  history.replaceState(null, "", eventSelectionLocation(location.href));
  location.reload();
}

export function switchActiveEvent(): void {
  forgetActiveEvent(window.localStorage);
  reloadAtEventSelectionLocation(window.location, window.history);
}
