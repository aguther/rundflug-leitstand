// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckboxField, Field, SearchField, SelectField, TextAreaField, TextField } from "./Field";

describe("design-system field contracts", () => {
  afterEach(() => cleanup());

  it("renders generic field labels, help, children, and custom classes", () => {
    const { rerender } = render(
      <Field className="synthetic-field" help="Hilfetext" label="Feldname">
        <input aria-label="Inhalt" />
      </Field>,
    );
    expect(screen.getByText("Feldname")).toBeTruthy();
    expect(screen.getByText("Hilfetext")).toBeTruthy();
    expect(screen.getByLabelText("Inhalt").closest(".ds-field")?.className).toContain(
      "synthetic-field",
    );

    rerender(
      <Field label="Ohne Hilfe">
        <input aria-label="Ohne Hilfe Inhalt" />
      </Field>,
    );
    expect(screen.queryByText("Hilfetext")).toBeNull();
  });

  it("links generated and explicit checkbox ids while exposing state classes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CheckboxField
        checked
        className="synthetic-checkbox"
        label="Ausgewählt"
        onChange={onChange}
        trailing="Zusatz"
      />,
    );
    const generated = screen.getByRole("checkbox", { name: "Ausgewählt" });
    expect(generated.id).not.toBe("");
    expect(generated.closest(".ds-checkbox-field")?.className).toContain("selected");
    await user.click(generated);
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByText("Zusatz")).toBeTruthy();

    rerender(<CheckboxField checked={false} disabled id="fixed-check" label="Gesperrt" />);
    const fixed = screen.getByRole("checkbox", { name: "Gesperrt" }) as HTMLInputElement;
    expect(fixed.id).toBe("fixed-check");
    expect(fixed.disabled).toBe(true);
    expect(fixed.closest(".ds-checkbox-field")?.className).toContain("disabled");
  });

  it("connects text, search, select, and textarea controls with labels and help", () => {
    render(
      <>
        <TextField className="text-class" help="Text-Hilfe" id="text-id" label="Textfeld" />
        <SearchField className="search-class" label="Suche" placeholder="Suchen" />
        <SelectField defaultValue="two" help="Auswahl-Hilfe" label="Auswahl">
          <option value="one">Eins</option>
          <option value="two">Zwei</option>
        </SelectField>
        <TextAreaField
          aria-describedby="external-help"
          help="Textbereich-Hilfe"
          id="notes"
          label="Notizen"
        />
        <TextAreaField label="Ohne Textbereich-Hilfe" />
      </>,
    );

    expect(document.getElementById("text-id")).not.toBeNull();
    expect(screen.getByText("Text-Hilfe")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Suche" }).getAttribute("placeholder")).toBe(
      "Suchen",
    );
    expect((screen.getByRole("combobox", { name: /Auswahl/ }) as HTMLSelectElement).value).toBe(
      "two",
    );
    expect(screen.getByText("Auswahl-Hilfe")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Notizen/ }).getAttribute("aria-describedby")).toBe(
      "external-help notes-help",
    );
    expect(screen.getByText("Textbereich-Hilfe").id).toBe("notes-help");
    expect(
      screen
        .getByRole("textbox", { name: "Ohne Textbereich-Hilfe" })
        .getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
