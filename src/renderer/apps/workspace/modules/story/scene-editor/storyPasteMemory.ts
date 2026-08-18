import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import {
  STORY_PASTE_MEMORY_PANEL_ID,
  type PasteSeparatorChoice,
  type SpeakerMappingTarget,
  type StoryPasteMemory
} from "@/lib/story/paste/storyPasteTypes";

/**
 * The paste wizard's per-project memory, on top of {@link PanelStateService}.
 *
 * This is what makes the wizard usable on a whole novel rather than on one chapter: the author says
 * once that `林` is a character and that their manuscript separates speakers with a fullwidth colon,
 * and every later paste opens with those answers already filled in.
 *
 * `PanelStateService` is deliberately the store. It writes to `.nlstudio/services/panel_state.json`,
 * which `shared/vcs/serviceStores` classifies as Studio state and keeps out of the versioned tree, and
 * it is exempt from the freeze latch - remembering a mapping is not an edit to the project, so it must
 * keep working while the author is browsing a frozen revision.
 */

const EMPTY_MEMORY: StoryPasteMemory = { version: 1, speakers: {}, separators: [] };

/**
 * How many named separator presets are kept. Presets are a convenience, not project data, and a list
 * long enough to need scrolling would be worse than the built-in chips it sits beside.
 */
const SEPARATOR_PRESET_LIMIT = 12;

/**
 * Read the memory, tolerating anything on disk that is not it.
 *
 * A hand-edited or future-version store degrades to "remember nothing" rather than throwing: the
 * wizard still opens, it just opens with no pre-fills, which is exactly the first-paste experience.
 */
export function getStoryPasteMemory(panelState: PanelStateService | null): StoryPasteMemory {
  const stored = panelState?.getPanelState<StoryPasteMemory>(STORY_PASTE_MEMORY_PANEL_ID);
  if (!stored || stored.version !== 1) {
    return EMPTY_MEMORY;
  }
  return {
    version: 1,
    speakers: stored.speakers && typeof stored.speakers === "object" ? { ...stored.speakers } : {},
    separators: Array.isArray(stored.separators) ? stored.separators.filter(isSeparatorPreset) : []
  };
}

/**
 * Remember what a batch of speaker labels was mapped to.
 *
 * Merged by hand rather than through `setPanelState`'s shallow merge: the merge is one level deep, so
 * writing `{ speakers: patch }` would replace the whole map and every label the author decided in an
 * earlier chapter would be forgotten.
 */
export function rememberStoryPasteSpeakers(
  panelState: PanelStateService | null,
  mappings: Record<string, SpeakerMappingTarget>
): void {
  if (!panelState || Object.keys(mappings).length === 0) {
    return;
  }
  const memory = getStoryPasteMemory(panelState);
  panelState.setPanelState<StoryPasteMemory>(STORY_PASTE_MEMORY_PANEL_ID, {
    version: 1,
    speakers: { ...memory.speakers, ...mappings }
  });
}

/**
 * Name and keep the separator choice currently in the wizard, newest first.
 *
 * Re-saving a name overwrites it rather than growing a second entry with the same label, because two
 * rows reading "Chapter files" and doing different things is not a list the author can use.
 */
export function saveStoryPasteSeparator(
  panelState: PanelStateService | null,
  name: string,
  choice: PasteSeparatorChoice
): void {
  const trimmed = name.trim();
  if (!panelState || !trimmed) {
    return;
  }
  const memory = getStoryPasteMemory(panelState);
  const rest = memory.separators.filter((preset) => preset.name !== trimmed);
  panelState.setPanelState<StoryPasteMemory>(STORY_PASTE_MEMORY_PANEL_ID, {
    version: 1,
    separators: [{ name: trimmed, choice }, ...rest].slice(0, SEPARATOR_PRESET_LIMIT)
  });
}

/** Drop one named preset. */
export function forgetStoryPasteSeparator(
  panelState: PanelStateService | null,
  name: string
): void {
  if (!panelState) {
    return;
  }
  const memory = getStoryPasteMemory(panelState);
  panelState.setPanelState<StoryPasteMemory>(STORY_PASTE_MEMORY_PANEL_ID, {
    version: 1,
    separators: memory.separators.filter((preset) => preset.name !== name)
  });
}

function isSeparatorPreset(value: unknown): value is StoryPasteMemory["separators"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }
  const preset = value as { name?: unknown; choice?: unknown };
  return (
    typeof preset.name === "string" &&
    Boolean(preset.choice) &&
    typeof (preset.choice as { kind?: unknown }).kind === "string"
  );
}
