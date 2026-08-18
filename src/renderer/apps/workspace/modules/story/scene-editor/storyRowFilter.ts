import {
  Aperture,
  Database,
  FileText,
  GitBranch,
  Images,
  MessageSquare,
  MonitorPlay,
  Music,
  Puzzle,
  Settings2,
  StickyNote,
  TriangleAlert,
  UserRound,
  type LucideIcon
} from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import { storyBlockBadge, type StoryBlockBadgeId } from "@/lib/story/storyRowProjection";
import { getCommandCategory, type StoryCommandCategoryId } from "./storyCommandCategories";

/**
 * What the row filter lets an author switch off — the answer to "what kind of line is this", cut for
 * READING rather than for browsing.
 *
 * It is deliberately not `StoryCommandCategoryId`: that taxonomy files a line by the subject it acts
 * on, so dialogue, narration and `/face` all sit under 角色 — and "show me only the dialogue" is the
 * single most-wanted view in the editor. So the three prose kinds are split out of 角色, choices are
 * split out of 流程 (they are the words a player reads, not machinery an author tunes), a note is its
 * own thing rather than a 工具, and 舞台's four subjects collapse back onto one facet because nobody
 * asks to see images but not videos.
 *
 * Everything else IS the category, which is why {@link STORY_ROW_FACET_BY_BADGE} reads as a table of
 * exceptions over a default.
 */
export type StoryRowFacetId =
  | "dialogue"
  | "narration"
  | "choice"
  | "note"
  | "character"
  | "stage"
  | "camera"
  | "scene"
  | "sound"
  | "flow"
  | "data"
  | "utils"
  | "invalid";

/**
 * The prose facets — the rows that survive "narrative only". Their order is the order they are read
 * in: what a person says, what the story says, what the player picks, what the author noted.
 */
export const STORY_ROW_NARRATIVE_FACETS: readonly StoryRowFacetId[] = [
  "dialogue",
  "narration",
  "choice",
  "note"
];

/** The staging facets, in the command palette's category order so the two surfaces read alike. */
export const STORY_ROW_STAGING_FACETS: readonly StoryRowFacetId[] = [
  "character",
  "stage",
  "camera",
  "scene",
  "sound",
  "flow",
  "data",
  "utils",
  "invalid"
];

export const STORY_ROW_FACETS: readonly StoryRowFacetId[] = [
  ...STORY_ROW_NARRATIVE_FACETS,
  ...STORY_ROW_STAGING_FACETS
];

/**
 * Badge → facet. Exhaustive on purpose: a new badge id is a compile error here rather than a row that
 * silently files under whichever facet the fallback happened to name.
 */
const STORY_ROW_FACET_BY_BADGE: Record<StoryBlockBadgeId, StoryRowFacetId> = {
  dialogue: "dialogue",
  narration: "narration",
  choice: "choice",
  choiceOption: "choice",
  note: "note",
  character: "character",
  image: "stage",
  displayable: "stage",
  transform: "stage",
  text: "stage",
  layer: "stage",
  video: "stage",
  vfx: "stage",
  camera: "camera",
  background: "scene",
  effect: "scene",
  nvl: "scene",
  jump: "scene",
  audio: "sound",
  wait: "flow",
  control: "flow",
  label: "flow",
  goto: "flow",
  break: "flow",
  cut: "flow",
  variable: "data",
  declaration: "data",
  blueprint: "utils",
  invalid: "invalid"
};

/**
 * The glyph and the hue each facet wears in the menu.
 *
 * Both are the ones its rows already wear on the page, which is the point: the tick that hides 声音
 * carries the same note in the same tone as the `/bgm` lines it is about to take away. The colour is
 * named as a CATEGORY rather than as a hex, so the filter cannot drift from the palette the manual,
 * the `/` menu and the row gutter all read; `invalid` names none because its rows wear the danger
 * tone, which is not a category and must not become one.
 */
const STORY_ROW_FACET_STYLE: Record<
  StoryRowFacetId,
  { icon: LucideIcon; category: StoryCommandCategoryId | null }
> = {
  dialogue: { icon: MessageSquare, category: "character" },
  narration: { icon: FileText, category: "character" },
  choice: { icon: GitBranch, category: "flow" },
  note: { icon: StickyNote, category: "utils" },
  character: { icon: UserRound, category: "character" },
  stage: { icon: Images, category: "stage" },
  camera: { icon: Aperture, category: "camera" },
  scene: { icon: MonitorPlay, category: "scene" },
  sound: { icon: Music, category: "sound" },
  flow: { icon: Settings2, category: "flow" },
  data: { icon: Database, category: "data" },
  utils: { icon: Puzzle, category: "utils" },
  invalid: { icon: TriangleAlert, category: null }
};

export function storyRowFacetIcon(facet: StoryRowFacetId): LucideIcon {
  return STORY_ROW_FACET_STYLE[facet].icon;
}

export function storyRowFacetColor(facet: StoryRowFacetId): string {
  const category = STORY_ROW_FACET_STYLE[facet].category;
  return category ? getCommandCategory(category).iconColor : "rgb(var(--nl-danger))";
}

/** Which facet a row files under. Reads the same badge the row's colour and icon already come from. */
export function storyRowFacet(block: StoryBlock): StoryRowFacetId {
  return STORY_ROW_FACET_BY_BADGE[storyBlockBadge(block).id];
}

// --- Who the row belongs to ----------------------------------------------------------------------

/**
 * The scene's cast as filter keys.
 *
 * A key rather than a character id, because half a script's speakers have no `Character` behind them:
 * a dialogue row binds to a NAME, and a name that nobody has made a character out of is still a
 * person saying lines. `id:` and `name:` keep the two apart so a temp speaker later promoted to a
 * real character does not inherit the hidden state of whatever else was called that.
 */
export type StoryRowSpeakerKey = string;

export function speakerKeyForCharacter(characterId: string): StoryRowSpeakerKey {
  return `id:${characterId}`;
}

export function speakerKeyForName(name: string): StoryRowSpeakerKey {
  return `name:${name}`;
}

/** Resolves a displayable's name to the character it refers to, when one exists. */
export type StoryCharacterNameLookup = (name: string) => string | null;

/**
 * Who a row belongs to, or `null` when nobody does.
 *
 * Wider than `paragraphActionCharacterId`, and deliberately: that one answers "is this row still the
 * speaker's paragraph", so it excludes `/show` and `/hide` — the two rows that decide whether the
 * character is on stage at all. Here the question is "is this row ABOUT this person", and an author
 * following one character through a scene wants their entrance every bit as much as their lines.
 *
 * A dialogue row with no speaker at all belongs to nobody: it is an unfinished line, and filing it
 * under a name the author has not chosen would hide it behind a tick they never set.
 */
export function storyRowSpeakerKeyOf(
  block: StoryBlock,
  resolveCharacterIdByName: StoryCharacterNameLookup
): StoryRowSpeakerKey | null {
  if (block.kind === "nodeAction") {
    if (block.payload.action !== "dialogue") {
      return null;
    }
    if (block.payload.characterId) {
      return speakerKeyForCharacter(block.payload.characterId);
    }
    return block.payload.speakerName ? speakerKeyForName(block.payload.speakerName) : null;
  }
  if (block.kind !== "action") {
    return null;
  }
  const payload = block.payload;
  if (payload.action === "character") {
    return payload.characterId ? speakerKeyForCharacter(payload.characterId) : null;
  }
  // `/fx` and `/transform` address a displayable by NAME — all those rows ever store. Same lookup
  // the row itself resolves through, so a rename that breaks one breaks both, and visibly.
  if (payload.action === "displayable" && payload.target.kind === "character") {
    const characterId = resolveCharacterIdByName(payload.target.name);
    return characterId
      ? speakerKeyForCharacter(characterId)
      : speakerKeyForName(payload.target.name);
  }
  return null;
}

// --- The filter ----------------------------------------------------------------------------------

/**
 * The filter as it is stored and passed around: two axes, each holding what the author SELECTED.
 *
 * **An empty axis is not a filter, it is the absence of one.** Nothing ticked shows everything, which
 * is what makes the panel readable at a glance: the ticks are the filter, and a blank panel says
 * "unfiltered" without the author having to work out that thirteen ticks mean the same thing.
 *
 * The axes are ANDed, and an empty one constrains nothing — so `{dialogue} × {Nattou}` is "Nattou's
 * dialogue", `{} × {Nattou}` is "everything of Nattou's", and `{dialogue} × {}` is "all the dialogue".
 * The useful combination is expressible, which is the whole reason the cast is a second axis and not
 * thirteen more rows in the first.
 *
 * A row with no speaker (narration, a background, a variable) fails a NON-EMPTY speaker axis: under
 * positive selection "只看 Nattou" means her rows, not her rows plus everything nobody says. The
 * narration comes back the moment the cast axis is cleared.
 */
export type StoryRowFilter = {
  facets: ReadonlySet<StoryRowFacetId>;
  speakers: ReadonlySet<StoryRowSpeakerKey>;
};

export const EMPTY_STORY_ROW_FILTER: StoryRowFilter = { facets: new Set(), speakers: new Set() };

/**
 * The panel's one preset: nothing but the dialogue.
 *
 * A preset earns its place by being the view an author reaches for often enough that two clicks is
 * one too many, and in a prose editor that is reading the script as spoken lines. It is expressible
 * by ticking one box, which is exactly why it is worth a button — the box is thirteen rows down a
 * list, and this is the top of the panel.
 */
export function dialogueOnlyStoryRowFilter(): StoryRowFilter {
  return { facets: new Set<StoryRowFacetId>(["dialogue"]), speakers: new Set() };
}

export function isStoryRowFilterActive(filter: StoryRowFilter): boolean {
  return filter.facets.size > 0 || filter.speakers.size > 0;
}

/** How many things are selected — what the toolbar button counts. */
export function storyRowFilterSize(filter: StoryRowFilter): number {
  return filter.facets.size + filter.speakers.size;
}

/** True when the filter is exactly the preset, which is how its button reads its own state. */
export function isDialogueOnlyStoryRowFilter(filter: StoryRowFilter): boolean {
  return filter.speakers.size === 0 && filter.facets.size === 1 && filter.facets.has("dialogue");
}

/** Whether a row survives the filter. Per-row, not per-subtree: filtering out a container leaves its children in place. */
export function storyRowPassesFilter(
  block: StoryBlock,
  filter: StoryRowFilter,
  resolveCharacterIdByName: StoryCharacterNameLookup
): boolean {
  if (filter.facets.size > 0 && !filter.facets.has(storyRowFacet(block))) {
    return false;
  }
  if (filter.speakers.size === 0) {
    return true;
  }
  const speaker = storyRowSpeakerKeyOf(block, resolveCharacterIdByName);
  return speaker !== null && filter.speakers.has(speaker);
}

/**
 * The filter widened just enough to let this row through — and no wider.
 *
 * The rule both callers need, in one place: **an act by the author wins over a view preference they
 * set earlier.** Navigating to a row (search, a deep link) and writing one are both such acts, and in
 * both cases the alternative is an invisible result — a selection on a row that is not on the page,
 * or a line that vanishes the instant it commits.
 *
 * Widen, never clear: dropping the filter outright would throw away every other choice the author made
 * to get a readable page, which is a bigger edit to their view than the one they asked for. Returns the
 * same object when the row already passed, so a caller can compare by identity and skip the write.
 *
 * An axis that is already empty is left empty. That is the one case where "add the row's own value"
 * would be wrong in the opposite direction: an unconstrained axis passes everything, and writing the
 * row's facet into it would narrow the page to that facet alone — a filter the author never set.
 */
export function revealRowInStoryRowFilter(
  block: StoryBlock,
  filter: StoryRowFilter,
  resolveCharacterIdByName: StoryCharacterNameLookup
): StoryRowFilter {
  if (storyRowPassesFilter(block, filter, resolveCharacterIdByName)) {
    return filter;
  }
  const facets =
    filter.facets.size === 0 ? filter.facets : new Set(filter.facets).add(storyRowFacet(block));
  let speakers = filter.speakers;
  if (speakers.size > 0) {
    const speaker = storyRowSpeakerKeyOf(block, resolveCharacterIdByName);
    // A row nobody speaks can never satisfy a cast selection, however many names are added to it —
    // so for that row the constraint itself is what has to go.
    speakers = speaker ? new Set(filter.speakers).add(speaker) : new Set();
  }
  return { facets, speakers };
}

/** A stored value from an older build (or a hand-edited state file) keeps only the facets this build knows. */
export function normalizeStoryRowFacets(value: unknown): StoryRowFacetId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const known = new Set<string>(STORY_ROW_FACETS);
  return [
    ...new Set(
      value.filter(
        (entry): entry is StoryRowFacetId => typeof entry === "string" && known.has(entry)
      )
    )
  ];
}

/**
 * Speaker keys as stored. Unlike the facets there is no closed vocabulary to check against — the cast
 * is the project's — so this only enforces the shape, and a key for a since-deleted character stays
 * put: it is inert (nothing matches it) and the menu lists it so the author can see what is selected.
 */
export function normalizeStoryRowSpeakers(value: unknown): StoryRowSpeakerKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" && (entry.startsWith("id:") || entry.startsWith("name:"))
      )
    )
  ];
}

// --- What the menu counts ------------------------------------------------------------------------

/** One entry of the menu's cast list: a speaker in this scene, or one that is selected and no longer in it. */
export type StoryRowSpeakerTally = {
  key: StoryRowSpeakerKey;
  /** The character this key names, or `null` for a speaker with no `Character` behind them. */
  characterId: string | null;
  /** Falls back to the key's own name for a temp speaker; the caller resolves a real character's. */
  name: string;
  count: number;
};

export type StoryRowTallies = {
  facets: Record<StoryRowFacetId, number>;
  speakers: StoryRowSpeakerTally[];
};

/**
 * How many rows of each kind, and of each speaker, the page currently holds.
 *
 * Counted over the rows the filter is ABOUT TO act on — the scene minus whatever is folded away, and
 * before any selection narrows it — so every number answers "how many would ticking this leave me",
 * including for the ticks already set. Counting the filtered set instead would show a zero beside
 * every box the author had not ticked, which is the one moment the number is worth reading.
 */
export function tallyStoryRows(
  blocks: readonly StoryBlock[],
  resolveCharacterIdByName: StoryCharacterNameLookup,
  alsoList: readonly StoryRowSpeakerKey[] = []
): StoryRowTallies {
  const facets = Object.fromEntries(STORY_ROW_FACETS.map((facet) => [facet, 0])) as Record<
    StoryRowFacetId,
    number
  >;
  const speakers = new Map<StoryRowSpeakerKey, StoryRowSpeakerTally>();
  const tallyFor = (key: StoryRowSpeakerKey): StoryRowSpeakerTally => {
    const existing = speakers.get(key);
    if (existing) {
      return existing;
    }
    const created: StoryRowSpeakerTally = key.startsWith("id:")
      ? { key, characterId: key.slice(3), name: "", count: 0 }
      : { key, characterId: null, name: key.slice(5), count: 0 };
    speakers.set(key, created);
    return created;
  };
  for (const block of blocks) {
    facets[storyRowFacet(block)] += 1;
    const key = storyRowSpeakerKeyOf(block, resolveCharacterIdByName);
    if (key) {
      tallyFor(key).count += 1;
    }
  }
  // A selected speaker who has no rows on this page still gets a line, at zero. Otherwise the tick
  // that is narrowing the page to nothing would be invisible here — a filter nobody can find is
  // worse than no filter, and the count on the toolbar button would name a tick with no home.
  for (const key of alsoList) {
    tallyFor(key);
  }
  return { facets, speakers: [...speakers.values()] };
}

export function storyRowFacetLabelKey(facet: StoryRowFacetId): TranslationKey {
  return `story.view.filter.facet.${facet}` as TranslationKey;
}
