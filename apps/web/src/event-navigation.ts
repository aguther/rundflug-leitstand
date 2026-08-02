import { forgetActiveEvent } from "./event-context";

export function eventSelectionLocation(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("event");

  return `${url.pathname}${url.search}${url.hash}`;
}

export function switchActiveEvent(): void {
  forgetActiveEvent(window.localStorage);
  window.location.assign(eventSelectionLocation(window.location.href));
}
