// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingValueType } from "@/lib/settings/types";
import type { SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { SettingsExplorer } from "./SettingsExplorer";
import { SETTINGS_HIGHLIGHT_RING, useSettingsHighlight } from "./settingsHighlight";

/**
 * Being opened *at* a panel, which is what another window's `highlight` asks for.
 *
 * A tint answers it for an ordinary row: the row is the control. A `Custom` panel is a surface
 * with several, and the author was sent to one of them - so the panel is told, and the mark
 * follows what it does with that. Both halves are pinned here because each fails invisibly: a
 * panel that reads the state and is not believed gets two rings, and one that ignores it gets
 * none at all, leaving the author in front of a panel with nothing to look at.
 */

const panel = vi.hoisted(() => ({ readsTheHighlight: false }));

/** A panel that reads the state and puts the mark where it wants it: one line and one class. */
function PanelThatReadsIt() {
  const highlighted = useSettingsHighlight();
  return (
    <button type="button" data-servers-add className={highlighted ? SETTINGS_HIGHLIGHT_RING : ""} />
  );
}

/** A panel written before any of this existed, which is every panel until it is changed. */
function PanelThatDoesNot() {
  return <button type="button" data-servers-add />;
}

function ServersPanelStub() {
  return panel.readsTheHighlight ? <PanelThatReadsIt /> : <PanelThatDoesNot />;
}

vi.mock("../panels", () => ({ SETTING_PANELS: { servers: ServersPanelStub } }));
vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({
    t: (key: string) => key,
    has: () => false,
    tn: (key: string) => key,
    locale: "en"
  })
}));

const CATEGORIES: SettingCategory[] = [
  { key: "servers", label: "Servers", description: "", order: 0 }
];
const DESCRIPTOR: SettingDescriptor = {
  id: "servers.list",
  type: SettingValueType.Custom,
  label: "Servers",
  description: "",
  defaultValue: null,
  panel: "servers"
};

function explorer(selectedSettingId?: string) {
  return render(
    <SettingsExplorer<SettingDescriptor>
      categories={CATEGORIES}
      getSettingsForCategory={() => [DESCRIPTOR]}
      describeSetting={(setting) => setting}
      getValue={() => null}
      onCommit={() => Promise.resolve()}
      selectedCategory="servers"
      selectedSettingId={selectedSettingId}
      selectedCategoryScrollSignal={1}
    />
  );
}

/** The one element wearing the mark, whichever of the two it turned out to be. */
function marked(): Element | null {
  return document.querySelector("[data-settings-highlight='on']");
}

beforeEach(() => {
  vi.useFakeTimers();
  panel.readsTheHighlight = false;
  // The explorer scrolls to whatever it was opened at, and jsdom implements no scrolling.
  Element.prototype.scrollTo = function scrollTo() {
    /* nothing to scroll */
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a panel Settings was opened at", () => {
  it("is marked around its whole block when the panel says nothing", () => {
    explorer("servers.list");
    act(() => undefined);

    expect(marked()?.getAttribute("data-settings-panel")).toBe("servers.list");
    expect(marked()?.className).toContain(SETTINGS_HIGHLIGHT_RING);
  });

  it("leaves the block unmarked when the panel marks a control of its own", () => {
    panel.readsTheHighlight = true;
    explorer("servers.list");
    act(() => undefined);

    expect(marked()).toBeNull();
    expect(document.querySelector("[data-servers-add]")?.className).toContain(
      SETTINGS_HIGHLIGHT_RING
    );
    expect(document.querySelector("[data-settings-panel]")?.className).not.toContain(
      SETTINGS_HIGHLIGHT_RING
    );
  });

  it("takes the mark off on its own, because a border that stays reads as a state", () => {
    explorer("servers.list");
    act(() => undefined);
    expect(marked()).not.toBeNull();

    act(() => vi.advanceTimersByTime(10_000));

    expect(marked()).toBeNull();
    expect(document.querySelector("[data-settings-panel]")?.className).not.toContain(
      SETTINGS_HIGHLIGHT_RING
    );
  });

  it("marks nothing when Settings was opened at no particular row", () => {
    explorer(undefined);
    act(() => undefined);

    expect(marked()).toBeNull();
  });
});
