import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../admin-view.tsx?raw";
import mainSource from "../../main.tsx?raw";

const stylesSource = readFileSync(new URL("./admin-v12.css", import.meta.url), "utf8");
const legacyStylesSource = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("V1.2 compact administration", () => {
  it("inherits the shared application header without admin-only geometry overrides", () => {
    expect(stylesSource).not.toContain(".app-shell.admin-shell > .app-header");
    expect(legacyStylesSource).not.toContain(".admin-shell > .app-header");
  });

  it("loads the semantic administration layer after the legacy styles", () => {
    expect(mainSource.indexOf('import "./styles.css"')).toBeLessThan(
      mainSource.indexOf('import "./features/admin/admin-v12.css"'),
    );
    expect(stylesSource).toContain("var(--ui-surface)");
    expect(stylesSource).toContain("var(--ui-bg)");
  });

  it("uses a dense table with an editor drawer", () => {
    expect(stylesSource).toContain("minmax(360px, 420px)");
    expect(stylesSource).toContain("height: 48px");
    expect(stylesSource).toContain(".master-data-drawer");
  });

  it("opens restart details only after choosing a reset level", () => {
    expect(appSource).toContain(
      "const [restartEditorOpen, setRestartEditorOpen] = useState(false)",
    );
    expect(appSource).toContain('hidden={adminArea !== "setup" || !restartEditorOpen}');
    expect(appSource).toContain("setRestartEditorOpen(true)");
    expect(appSource).toContain("setRestartEditorOpen(false)");
    expect(stylesSource).toMatch(/\.admin-shell \.reset-levels\[hidden\]\s*\{\s*display: none;/);
  });

  it("uses the desktop viewport without an avoidable page-level scrollbar", () => {
    expect(stylesSource).toContain("height: 100dvh");
    expect(stylesSource).toContain("overflow: hidden");
  });
});
