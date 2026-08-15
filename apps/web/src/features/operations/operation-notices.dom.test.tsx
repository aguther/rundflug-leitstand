// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectionNotice,
  EmergencyNotice,
  InterruptionNotice,
  OperationalNotice,
} from "./operation-notices";

afterEach(() => cleanup());

describe("operational notices", () => {
  it("shows connection failures with the age of the last confirmed state", () => {
    const lastConfirmedAt = new Date(Date.now() - 42_000).toISOString();
    const { rerender } = render(
      <ConnectionNotice error="Verbindung unterbrochen" lastConfirmedAt={lastConfirmedAt} />,
    );

    expect(screen.getByText(/Möglicherweise veraltet/).textContent).toMatch(
      /letzte Bestätigung vor 42 s · Verbindung unterbrochen/,
    );

    rerender(<ConnectionNotice error="Verbindung unterbrochen" />);
    expect(screen.getByText(/Möglicherweise veraltet/).textContent).toMatch(
      /kein bestätigter Stand · Verbindung unterbrochen/,
    );

    rerender(<ConnectionNotice error={null} />);
    expect(screen.queryByText(/Möglicherweise veraltet/)).toBeNull();
  });

  it("only exposes emergency and interruption warnings while their state is active", () => {
    const { rerender } = render(
      <>
        <EmergencyNotice active={false} />
        <InterruptionNotice active={false} />
      </>,
    );

    expect(screen.queryByText("Notfallmodus aktiv")).toBeNull();
    expect(screen.queryByText("Flugbetrieb unterbrochen")).toBeNull();

    rerender(
      <>
        <EmergencyNotice active />
        <InterruptionNotice active />
      </>,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Notfallmodus aktiv · keine Verkäufe oder neuen Aufrufe",
    );
    expect(screen.getByText(/Flugbetrieb unterbrochen/).parentElement?.textContent).toMatch(
      /laufende Flüge bleiben dokumentierbar/,
    );
  });

  it("presents an operational note without giving it safety or release semantics", () => {
    const { rerender } = render(<OperationalNotice note={undefined} />);

    expect(screen.queryByText("Betriebshinweis:")).toBeNull();

    rerender(<OperationalNotice note="Nordtor vorübergehend geschlossen" />);

    expect(screen.getByText("Betriebshinweis:").parentElement?.textContent).toContain(
      "Betriebshinweis: Nordtor vorübergehend geschlossen",
    );
    expect(
      screen.getByText("Organisatorische Information ohne Sicherheits- oder Freigabewirkung."),
    ).toBeTruthy();
  });
});
