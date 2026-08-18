import type { LucideIcon } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import { storySecondsToMs } from "@shared/utils/storyTime";
import type { StoryCommandParam, StoryCommandParamType } from "../storyCommandGrammar";
import type {
  StoryCommandContext,
  StoryCommandResolutionIssue,
  StoryCommandSpan,
  StoryCommandStageObjectKind,
  StoryCommandTargetKind,
  StoryCommandValue,
  StoryPuppetChannel
} from "../storyCommandValues";
import type { StoryCommandGroupId } from "../storyCommandCategories";

/**
 * The single source of truth for one slash command.
 *
 * A command used to be smeared across four unlinked files - an id union member, a palette entry, a
 * grammar def, a `createBlockForCommand` case and an `applyCommandArgs` case - connected only by
 * strings, so renaming a grammar param silently disconnected the apply case that read it. A spec
 * carries all of it in one object, and `ResolvedArgsOf` closes the loop at the type level: `build`
 * receives an args object keyed by this spec's own param names, so a drifted name is a compile error,
 * not a value that resolves and is never written.
 *
 * The pure pipeline layers (parser / cursor / ghost / candidates / resolution) stay generic and read
 * only the grammar-shaped projection (`specToDef`); everything command-specific lives here.
 */

/** A param as authored on a spec: the grammar param minus `name`, which the record key supplies. */
export type StoryCommandParamSpec = Omit<StoryCommandParam, "name">;

/** Params are an ordered record - key order is declaration order, and positionals must lead. */
export type StoryCommandParamsShape = Readonly<Record<string, StoryCommandParamSpec>>;

/**
 * The resolved-args object a spec's `build`/`validate` receive: same keys as the spec's params, each
 * possibly undefined (an unfilled arg is not an error - see `core` for what an unfilled one gates).
 */
export type ResolvedArgsOf<P extends StoryCommandParamsShape> = {
  readonly [K in keyof P]?: StoryCommandValue;
};

export type StoryCommandBuildContext = {
  generateId: () => string;
  /** The rest of the line for text-bearing blocks created without their text arg. */
  initialText?: string;
  context: StoryCommandContext;
};

/** Validation helpers handed to a spec's `validate` - spans come from the parsed line, not the spec. */
export type StoryCommandValidateContext = {
  context: StoryCommandContext;
  /** The source span of a param's value, for anchoring an issue. Undefined while unfilled. */
  spanOf: (paramName: string) => StoryCommandSpan | undefined;
};

export type StoryCommandSpec<P extends StoryCommandParamsShape = StoryCommandParamsShape> = {
  /** Stable identity: keys `story.command.<id>.label` / `.detail` and telemetry. Never shown raw. */
  id: string;
  /**
   * The canonical keyword. English, and always accepted.
   *
   * Not the only accepted spelling: the active command locale's menu label is derived into an alias
   * table (`registry.ts`), so `/背景` reaches `bg` too. This one never moves, which is what keeps a
   * script written in one locale parsing in every other.
   */
  token: string;
  aliases?: readonly string[];
  /**
   * Where this command files itself when it has NO target param.
   *
   * A1 narrowed the meaning: a command that DOES take a target is filed by that param's `accepts`,
   * under every subject it accepts at once (`/show` under all five), so a single `category` slot
   * could never have expressed it. For those commands this field only decides which single section
   * the flat surfaces - the `/` browse menu and the command reference - print them under.
   */
  category: StoryCommandGroupId;
  /**
   * The command's own glyph - what every surface that NAMES this command draws beside it: the `/`
   * menu, the action creator's list and command page, and a committed row's plate (through
   * `storyVerbCommandId`, which is the same block→command relation the row's verb already reads).
   *
   * Required, and per-command rather than per-group, because the group icon was answering the wrong
   * question. A group is the COLOUR unit (`storyCommandCategories.ts`) - eleven hues that say which
   * subject a line acts on - and drawing its icon too meant all eleven sound commands wore one Music
   * note and all nine character commands one person: the column of glyphs said "sound, sound, sound"
   * where the words beside it already did, and never "this one stops it, this one seeks it". The
   * colour still files the row by subject; the icon now says the verb, so the two carry different
   * halves of the sentence instead of the same half twice.
   *
   * Distinctness is the point, so no two specs share one - `specs.test.ts` fails when they do.
   */
  icon: LucideIcon;
  params: P;
  /**
   * Build the finished block from the resolved args - declarations included, since v6 made a
   * declaration a row like any other.
   *
   * Receives every arg possibly-undefined and must return a valid block regardless - the menu path
   * calls it with `{}` to get the default block, and the core gating (not this function)
   * is what decides whether an unfilled line commits.
   */
  build?: (args: ResolvedArgsOf<P>, ctx: StoryCommandBuildContext) => StoryBlock;
  /** Cross-param checks the generic resolver cannot know (`/font` size XOR color, `/set` type fit). */
  validate?: (
    args: ResolvedArgsOf<P>,
    ctx: StoryCommandValidateContext
  ) => StoryCommandResolutionIssue[];
  /**
   * Fill args the author left blank, after resolution - the auto-name pass that lets
   * `/image forest.png` land an image called `forest`. Returns only the keys it adds.
   */
  deriveArgs?: (
    args: ResolvedArgsOf<P>,
    context: StoryCommandContext
  ) => Partial<Record<keyof P & string, StoryCommandValue>>;
  /**
   * Open the property inspector right after commit - for commands whose surface is inspector-first
   * (`/fx`).
   *
   * A predicate is for a command where only SOME lines are inspector-first: `/camera motion` has to
   * pick a Story Motion, which is a binding no line can carry, while `/camera zoom 2` is complete as
   * typed and must not have the caret yanked out of the row.
   */
  inspectorAfterCommit?: boolean | ((block: StoryBlock) => boolean);
  /**
   * Container scaffolding the controller runs after insert: `condition` creates the if-branch
   * (carrying this line's `test` expression), `choice` creates the first option.
   */
  scaffold?: "condition" | "choice";
  /**
   * The high-frequency param keys surfaced as inline quick-edit tokens on a committed row —
   * the "inline high-frequency" half. A subset of `params`. There is no block→args
   * parser, so the row's render path (`getQuickParams`) reads these values straight from the payload;
   * this declaration keeps the intended set discoverable in one place alongside the rest of the spec.
   */
  quickParams?: readonly (keyof P & string)[];
  /**
   * Whether this command has anything to offer in THIS project - the gate the browse surfaces run
   * before listing it. Absent means always, which is what all but one command answer.
   *
   * Declared here rather than filtered inside the palette because `SPEC_PALETTE` is a module
   * constant built once at import time, with no project in sight. The consumers hold the context
   * already, so the rule lives on the spec and the surfaces apply it.
   *
   * It gates the MENUS, not the parser: a command hidden here still resolves when it is typed.
   * That is deliberate rather than a gap - a command whose only reason to be hidden is an empty
   * list has a `core` param reading that same list, so the typed line cannot resolve its argument
   * and the row stays a draft, saying so in place.
   */
  available?: (context: StoryCommandContext) => boolean;
  /**
   * Working lines for the manual, written exactly as an author would type them.
   *
   * Written in the canonical English spellings, and left that way in every locale. A locale may add
   * spellings for the command and its params, but the canonical ones are the spellings
   * that work everywhere — which is exactly what an example should teach — and enum values have no
   * localized form at all, so a translated example would be part real and part invented.
   *
   * `specs.test.ts` runs every one of these through parse → resolve → build against the suite's
   * fixture project, so an example that stopped being legal fails the suite instead of teaching an
   * author a line that no longer works. Use the fixture's names (`Alice`, `forest_day`, `gold`, …).
   */
  examples?: readonly string[];
};

/**
 * Declare a spec. The identity function exists for inference (P is captured from the literal) plus
 * the one structural rule a record cannot express: at most one param is greedy and it comes last -
 * it consumes the rest of the line, so nothing can follow it. Positionals fill in declaration order
 * among themselves; named params may sit anywhere in the record (declaration order is also the ghost
 * hint's order, so put them where an author would type them).
 */
export function defineStoryCommand<P extends StoryCommandParamsShape>(
  spec: StoryCommandSpec<P>
): StoryCommandSpec<P> {
  let sawGreedy = false;
  for (const [name, param] of Object.entries(spec.params)) {
    if (sawGreedy) {
      throw new Error(
        `/${spec.token}: param "${name}" follows a greedy param; greedy must be last.`
      );
    }
    sawGreedy = param.greedy === true;
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Value coercers - how `build` reads a StoryCommandValue without re-proving its kind everywhere.
// ---------------------------------------------------------------------------

export function asNumber(value: StoryCommandValue | undefined): number | undefined {
  return value?.kind === "number" ? value.value : undefined;
}

/** Durations are typed in seconds and stored in milliseconds - `d=0.3` means 300ms. */
export function asDurationMs(value: StoryCommandValue | undefined): number | undefined {
  const seconds = asNumber(value);
  return seconds === undefined ? undefined : storySecondsToMs(seconds);
}

export function asBoolean(value: StoryCommandValue | undefined): boolean | undefined {
  return value?.kind === "boolean" ? value.value : undefined;
}

export function asEnum(value: StoryCommandValue | undefined): string | undefined {
  return value?.kind === "enum" ? value.value : undefined;
}

export function asColor(value: StoryCommandValue | undefined): string | undefined {
  return value?.kind === "color" ? value.color : undefined;
}

/** A free-typed name (`text` value), trimmed. Empty means "leave the block's default". */
export function asText(value: StoryCommandValue | undefined): string | undefined {
  if (value?.kind !== "text") {
    return undefined;
  }
  const trimmed = value.value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A puppet's requested state name, or undefined - which the payload stores as "no request" (`null`). */
export function asPuppetName(value: StoryCommandValue | undefined): string | undefined {
  return value?.kind === "puppetName" ? value.name : undefined;
}

/** A resolved project audio track's id, or undefined - which means "leave the row's default". */
export function asAudioTrackId(value: StoryCommandValue | undefined): string | undefined {
  return value?.kind === "audioTrack" ? value.trackId : undefined;
}

/**
 * A resolved build variant's id, or undefined while the slot is unfilled.
 *
 * The id and never the name: a payload holding the name would stop resolving the moment the author
 * renamed the variant, which is the one thing renaming must not do.
 */
export function asAppTagId(value: StoryCommandValue | undefined): string | undefined {
  return value?.kind === "appTag" ? value.appTagId : undefined;
}

/** The resolved target of a generic verb (`/show poster`), or undefined while unresolved. */
export function asTarget(
  value: StoryCommandValue | undefined
): Extract<StoryCommandValue, { kind: "target" }>["target"] | undefined {
  return value?.kind === "target" ? value.target : undefined;
}

// ---------------------------------------------------------------------------
// Shared param fragments - the shared vocabulary table. One key, one meaning.
// ---------------------------------------------------------------------------

/**
 * A time in seconds — the one numeric shape in the whole vocabulary that carries a unit.
 *
 * Every slot measured in seconds shares it, so `d=1s`, `fade=0.5s` and `/wait 2s` are one rule rather
 * than four. The unit is optional on input and is what a committed row prints (`持续时间=1s`), which is
 * the point of declaring it: a row may only show a line the author could have typed.
 */
export const SECONDS_TYPE: StoryCommandParamType = { kind: "number", min: 0, unit: "s" };

/** `d=` - a duration in seconds. */
export function secondsParam(hint = "duration"): StoryCommandParamSpec {
  return { aliases: ["duration"], hint, type: SECONDS_TYPE };
}

/** The `at=` word list. Exported so a positional placement slot spells the same three words. */
export const PLACEMENT_OPTIONS = [
  { value: "left" },
  { value: "center" },
  { value: "right" }
] as const;

/**
 * A state name of a puppet-kind character's backend, on one channel (`/motion Doll run`).
 *
 * Never `core`. The engine's `null` on any of these channels is the *absence* of a request, and it
 * visibly clears - so `/motion Doll` with no name is a legal, meaningful line ("stop running, rest"),
 * and requiring the name would have deleted the only way to say it.
 */
export function puppetNameParam(
  channel: StoryPuppetChannel,
  dependsOn: string,
  hint: string
): StoryCommandParamSpec {
  return { hint, type: { kind: "puppetName", channel, dependsOn }, positional: true };
}

/**
 * `track=` - the project audio track a play lands on.
 *
 * Only on the two commands that CREATE a sound (`/bgm`, `/sound`). A `/vol piano 0.4` addresses a
 * handle that already has a track and cannot be given a second one, so offering the key there would
 * be a control that reads as an edit and compiles to a diagnostic.
 */
export function audioTrackParam(): StoryCommandParamSpec {
  return { hint: "track", type: { kind: "audioTrack" } };
}

/**
 * A build variant the project can be shipped as (`Demo`, `Bonus`).
 *
 * Positional and `core`: a line that names a variant is about that variant, and one with the slot
 * empty says nothing a build could act on. One spelling for every command that takes a variant, so
 * the key, the offer list and the stored id cannot differ between two of them.
 *
 * The offer list is the AUTHORED variants; the release one is not among them
 * (`storyCommandCandidates.ts`). Resolution still accepts its name, and a row naming it is a defined
 * state rather than an error - it is what a deleted variant's id resolves to, and it cuts nothing.
 */
export function appTagParam(hint = "appTag"): StoryCommandParamSpec {
  return { hint, type: { kind: "appTag" }, positional: true, core: true };
}

/** `at=` - a placement. */
export function placementParam(): StoryCommandParamSpec {
  return {
    aliases: ["pos"],
    hint: "placement",
    type: { kind: "enum", options: PLACEMENT_OPTIONS }
  };
}

/**
 * A positional reference to something already on stage, or a character - the generic verbs' subject.
 *
 * `accepts` is load-bearing twice over: resolution dispatches on it, and the sidebar files the command
 * under every subject it names (§4.2). Widening it therefore adds menu entries as well as legal lines.
 */
/**
 * Whether a just-committed block should route the author into the property inspector. The one place
 * that reads {@link StoryCommandSpec.inspectorAfterCommit}, so its boolean and predicate forms cannot
 * drift apart at the two call sites the controller has.
 */
export function opensInspectorAfterCommit(
  spec: { inspectorAfterCommit?: boolean | ((block: StoryBlock) => boolean) } | null | undefined,
  block: StoryBlock
): boolean {
  const rule = spec?.inspectorAfterCommit;
  return typeof rule === "function" ? rule(block) : rule === true;
}

export function targetParam(
  accepts: readonly StoryCommandTargetKind[],
  options?: { core?: boolean; skippable?: boolean; fallbackKind?: StoryCommandStageObjectKind }
): StoryCommandParamSpec {
  return {
    hint: "target",
    type: {
      kind: "target",
      accepts,
      ...(options?.fallbackKind ? { fallbackKind: options.fallbackKind } : {})
    },
    positional: true,
    ...(options?.core ? { core: true } : {}),
    ...(options?.skippable ? { skippable: true } : {})
  };
}

export type { StoryCommandParamType };
