// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductReferenceRotation } from "./product-reference-rotation";

afterEach(cleanup);

describe("product reference rotation summary", () => {
  it("shows the event-wide breakdown and updates with the product reference time", () => {
    const view = render(
      <ProductReferenceRotation
        boardingMinutes={8}
        bufferMinutes={3}
        deboardingMinutes={5}
        offBlockToOnBlockMinutes={20}
      />,
    );

    expect(screen.getByText("8 Min. Boarding")).toBeTruthy();
    expect(screen.getByText("20 Min. Offblock–Onblock")).toBeTruthy();
    expect(screen.getByText("36 Min. Umlauf")).toBeTruthy();
    expect(
      screen.getByText(
        "Die Bodenzeiten gelten derzeit veranstaltungsweit für alle Produkte und Flugzeuge.",
      ),
    ).toBeTruthy();

    view.rerender(
      <ProductReferenceRotation
        boardingMinutes={8}
        bufferMinutes={3}
        deboardingMinutes={5}
        offBlockToOnBlockMinutes={25}
      />,
    );
    expect(screen.getByText("41 Min. Umlauf")).toBeTruthy();
  });
});
