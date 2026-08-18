import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { storyVars as enStoryVars } from "@shared/i18n/catalog/en/storyVars";
import type { StoryId, StorySceneId } from "@shared/types/story";
import { StoryVariablesPanel, VariableJumpRow } from "./StoryVariablesPanel";
import { STORY_VARIABLES_PANEL_ID } from "./storyVariablesPanelId";

/**
 * `renderToStaticMarkup`, so no workspace has to be mounted. Effects therefore never run, which is
 * exactly the state under test for the panel itself: which SECTIONS it puts up before it has heard
 * from the registry or a story. The rows inside them are filled by effects and are not the point
 * here.
 *
 * The two hooks that demand a provider are stubbed rather than provided. A null context is what the
 * panel already handles - every service lookup is guarded on it - so the stub is a state the real
 * app passes through on every workspace boot, not a fiction invented for the test.
 */

vi.mock("@/apps/workspace/context", () => ({
  useWorkspace: () => ({ context: null, isInitialized: false })
}));

vi.mock("@/apps/workspace/registry", () => ({
  useRegistry: () => ({ openEditorTab: () => undefined, setPanelVisibility: () => undefined })
}));

/**
 * Guards the two rulings the read-only row exists to satisfy, neither of which is visible from the
 * component's own source once someone starts "improving" it:
 *
 *  - It must READ as clickable without being told so. The affordance is structural (a real button,
 *    with the pointer cursor and a hover treatment), which is exactly what a later edit that swaps
 *    it for a styled `<div>` would silently drop.
 *  - It must carry nothing but the variable and its type. A source badge, a chip, an "in story" label
 *    or a hint line is the failure mode this panel was rebuilt to avoid, so the row's text is
 *    asserted whole rather than by substring.
 */

const markupOf = (name: string) =>
  renderToStaticMarkup(<VariableJumpRow name={name} valueType="number" onJump={() => undefined} />);

describe("the read-only variable row", () => {
  it("is a button, so it is reachable and carries the pointer cursor", () => {
    const markup = markupOf("gold");
    expect(markup).toMatch(/^<button/);
    expect(markup).toContain("cursor-pointer");
  });

  it("changes on hover, which is what makes a static row read as a target", () => {
    // Three at once - fill behind it, the name to full contrast, the border from subtle to solid.
    const markup = markupOf("gold");
    expect(markup).toContain("hover:bg-fill");
    expect(markup).toContain("hover:text-fg");
    expect(markup).toContain("hover:border-edge");
  });

  it("says the variable and its type, and nothing else", () => {
    const text = markupOf("gold")
      .replace(/<[^>]*>/g, "|")
      .split("|")
      .filter(Boolean);
    expect(text).toEqual(["gold", "Number"]);
  });
});

/**
 * The panel is a static module now, so it renders with no payload at all - and the sections it puts
 * up in that state are the whole point of making it one. Saved and global are project resources and
 * must be reachable with no story open; the scene scope belongs to a focused scene and must be
 * absent, not empty, without one.
 */

const withPayload = (payload?: { storyId: StoryId; sceneId: StorySceneId }) =>
  renderToStaticMarkup(
    <StoryVariablesPanel panelId={STORY_VARIABLES_PANEL_ID} payload={payload} />
  );

const A_SCENE = {
  storyId: "story-1" as StoryId,
  sceneId: "scene-1" as StorySceneId
};

describe("the variables panel with no story focused", () => {
  it("still offers both project scopes, which is why it is a static module", () => {
    const markup = withPayload();
    expect(markup).toContain(enStoryVars.saved.title);
    expect(markup).toContain(enStoryVars.persistent.title);
  });

  it("omits the scene section rather than explaining its absence", () => {
    const markup = withPayload();
    expect(markup).not.toContain(enStoryVars.scene.title);
    // And no stand-in for it either: the panel must not grow a line about there being no scene.
    expect(markup).not.toContain(enStoryVars.scene.hint);
  });
});

describe("the variables panel with a story scene focused", () => {
  it("adds the scene section, keeping the project scopes it already had", () => {
    const markup = withPayload(A_SCENE);
    expect(markup).toContain(enStoryVars.saved.title);
    expect(markup).toContain(enStoryVars.persistent.title);
    expect(markup).toContain(enStoryVars.scene.title);
  });

  it("puts the scene scope last, after the two this panel authors", () => {
    // Ownership order, not alphabetical or chronological: what the panel writes comes before
    // what it only mirrors.
    const markup = withPayload(A_SCENE);
    expect(markup.indexOf(enStoryVars.saved.title)).toBeLessThan(
      markup.indexOf(enStoryVars.persistent.title)
    );
    expect(markup.indexOf(enStoryVars.persistent.title)).toBeLessThan(
      markup.indexOf(enStoryVars.scene.title)
    );
  });
});
