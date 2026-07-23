import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AircraftPickerMeta } from "./flight-line-assist";

const aircraft = {
  passengerSeats: 1,
  resourceGroupName: "Rundflug Oldtimer",
} as Parameters<typeof AircraftPickerMeta>[0]["aircraft"];

describe("Assist-Flugzeugauswahl", () => {
  it("zeigt Ressourcengruppe, Plätze und vorhandene Ressource ohne Fluggruppenkennung", () => {
    const markup = renderToStaticMarkup(
      createElement(AircraftPickerMeta, {
        aircraft,
        gateLabel: "Halle",
      }),
    );

    expect(markup).toContain("Rundflug Oldtimer · 1 Plätze");
    expect(markup).toContain('class="assist-v15-gate"');
    expect(markup).toContain("Halle");
    expect(markup).not.toContain("RO-107");
  });

  it("blendet die Ressourcenzeile ohne Gate aus und wiederholt die Ressourcengruppe nicht", () => {
    const markup = renderToStaticMarkup(createElement(AircraftPickerMeta, { aircraft }));

    expect(markup).not.toContain('class="assist-v15-gate"');
    expect(markup.match(/Rundflug Oldtimer/g)).toHaveLength(1);
  });
});
