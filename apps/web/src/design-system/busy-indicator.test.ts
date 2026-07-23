import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, type ButtonProps } from "./components/Button";
import { IconButton, type IconButtonProps } from "./components/IconButton";

describe("Busy Indicator", () => {
  it("ersetzt nur im auslösenden Textbutton den sichtbaren Inhalt und behält dessen Aktionsnamen", () => {
    const initiatingProps: ButtonProps = {
      busy: true,
      children: createElement("span", null, createElement("i"), "Speichern"),
    };
    const neighborProps: ButtonProps = { disabled: true, children: "Andere Aktion" };
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(Button, initiatingProps),
        createElement(Button, neighborProps),
      ),
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Speichern wird ausgeführt"');
    expect(markup).toContain("ds-button-content ds-button-content--hidden");
    expect(markup.match(/ds-busy-indicator/g)).toHaveLength(1);
    expect(markup).toContain("Andere Aktion");
  });

  it("verwendet beim IconButton die zugängliche Aktionsbezeichnung", () => {
    const props: IconButtonProps = {
      busy: true,
      label: "Liste aktualisieren",
      children: createElement("svg", { "aria-hidden": true }),
    };
    const markup = renderToStaticMarkup(createElement(IconButton, props));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Liste aktualisieren wird ausgeführt"');
    expect(markup).toContain("ds-button-content ds-button-content--hidden");
  });
});
