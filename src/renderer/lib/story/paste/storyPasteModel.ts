import type { StoryBlock } from "@shared/types/story";
import { assertValidStoryEntityId } from "@shared/utils/storyId";
import type {
  MaterializeContext,
  MaterializedPaste,
  PasteSeparatorChoice,
  PasteSeparatorKind,
  PasteSeparatorProblem,
  PasteSpeakerTally,
  PasteSplit,
  PastedLine,
  PastePlan,
  PastePlanInput,
  PastePlanRow,
  PlainPasteAnchor,
  StoryPasteRoute
} from "./storyPasteTypes";
import { STORY_SCRIPT_HEADER } from "./storyPasteTypes";

/**
 * Pure model behind the paste wizard. See `storyPasteTypes.ts` for what each shape means.
 *
 * The one idea the rest of the file follows from: **a separator is judged by how well it explains the
 * text, not by how many lines it hits.** Every string has a colon in it somewhere, so hit count alone
 * would confidently declare a novel excerpt to be a screenplay in which the speakers are called
 * "He remembered the rule his father taught him". What distinguishes a cast list from prose is that its
 * labels look like names - short, punctuation-free, and above all *reused* - so that is what gets scored.
 *
 * Reuse is the load-bearing half. Shape rules alone cut both ways: they have to be crude enough to
 * catch `她停下来，回头看了一眼身后的长廊` and forgiving enough to keep `Mrs. Hudson`, and any single
 * threshold that does both is wrong somewhere. A cast list, on the other hand, comes back to its names
 * - and prose, however name-shaped its clauses, does not.
 *
 * The other invariant worth stating once: nothing here throws on author input. The separator, the regex
 * and the mappings are all being typed live next to a preview, so every intermediate state has to
 * produce *a* split - a wrong one the author can see and correct, never an exception that empties the
 * wizard. The only functions that throw are the ones fed by Studio itself
 * ({@link materializePastedRows} on a bad id factory), where throwing is the point.
 */

// ---------------------------------------------------------------------------
// Line normalisation
// ---------------------------------------------------------------------------

/**
 * Pasted text -> the lines that become rows.
 *
 * Blank lines are dropped rather than turned into empty rows: in prose a blank line is a paragraph
 * break, a typographic gesture with no story action behind it, and a 40-row scene half made of empty
 * dialogue boxes is not what the author copied.
 *
 * Each line is trimmed, and that trimmed form is what {@link PastedLine.raw} carries. It is the reason
 * `raw` can be described as "the line as pasted": the *interior* is untouched (which is what the
 * "not a speaker" undo path needs - see {@link planPastedRows}), while indentation, stray tabs and a
 * CRLF's `\r` never reach a row's text.
 */
function toPastedLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Separators
// ---------------------------------------------------------------------------

type BuiltinSeparatorKind = Exclude<PasteSeparatorKind, "none" | "regex">;

type SeparatorMatch = { speaker: string; text: string };

/**
 * The built-in separators, in the order {@link inferPasteSeparator} prefers them on a tie - which is
 * the order they are declared in {@link PasteSeparatorKind}.
 *
 * Every pattern splits at its FIRST occurrence and keeps the remainder whole, because `林：他说：「走吧」`
 * is one line spoken by 林, not a line spoken by `林：他说`. For the two colon forms that falls out of
 * a negated character class; `dash` needs a lazy label to get there.
 *
 * `dash` is the one that has to be defensive: without the mandatory whitespace on both sides,
 * `well-known` is a speaker called "well", and an English paste would be nothing but speakers.
 */
const BUILTIN_SEPARATORS: { kind: BuiltinSeparatorKind; pattern: RegExp }[] = [
  { kind: "colon", pattern: /^([^:]+):(.*)$/ },
  { kind: "fullwidthColon", pattern: /^([^：]+)：(.*)$/ },
  { kind: "dash", pattern: /^(.+?)[ \t　]+[-–—]+[ \t　]+(.*)$/ },
  { kind: "lenticular", pattern: /^【([^】]+)】(.*)$/ },
  { kind: "cornerBracket", pattern: /^「([^」]+)」(.*)$/ },
  { kind: "tab", pattern: /^([^\t]+)\t(.*)$/ }
];

/**
 * A trailing parenthetical on a label - `ALICE (whispering, to herself)`, `林（小声）`.
 *
 * A screenplay parenthetical is a stage direction, not part of the name: left attached it makes every
 * delivery note its own cast member, and pushes the label past both the length and the punctuation
 * rules, so a perfectly ordinary screenplay reads as prose.
 *
 * Only stripped when a name survives it: `(pause): …` is all aside and no name, and inventing an empty
 * speaker for it would be worse than leaving it whole for the author to judge.
 */
const TRAILING_PARENTHETICAL = /^(.*?)[ \t　]*([(（][^)）]*[)）])$/;

/**
 * A match needs both halves to be non-empty.
 *
 * `label chapter_one:` and `【第一章】` are section headers, not speakers with nothing to say, and
 * counting them as speaker lines would both invent cast members and let a file of headings out-score a
 * real separator.
 *
 * The aside is moved to the front of the line rather than dropped. It is the author's own text, and a
 * paste that silently deletes words is the one failure this wizard exists to make impossible - the
 * preview shows exactly where it went.
 */
function toMatch(matched: RegExpMatchArray | null): SeparatorMatch | null {
  if (!matched) {
    return null;
  }
  const speaker = matched[1].trim();
  const text = matched[2].trim();
  if (speaker.length === 0 || text.length === 0) {
    return null;
  }
  const aside = speaker.match(TRAILING_PARENTHETICAL);
  const name = aside?.[1].trim() ?? "";
  return aside && name.length > 0
    ? { speaker: name, text: `${aside[2]} ${text}` }
    : { speaker, text };
}

function matchPattern(pattern: RegExp, raw: string): SeparatorMatch | null {
  return toMatch(raw.match(pattern));
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/** Longer than this and it is a clause, not a name. Real cast names sit far under it. */
const MAX_PLAUSIBLE_LABEL_LENGTH = 24;

/**
 * Sentence punctuation inside a label is the giveaway that the "separator" landed mid-sentence:
 * `她停下来，回头看了一眼身后的长廊：什么也没有。` has a perfectly short prefix, and it is still prose.
 *
 * `.` is deliberately NOT in the set. `Mrs.`, `Dr.`, `St.` and `Jr.` are ordinary inside names, and
 * charging them as sentence punctuation made every English manuscript that uses an honorific score
 * negative - the feature silently switching itself off for a whole language. Length and repetition
 * already carry the weight a full stop was standing in for.
 */
const LABEL_SENTENCE_PUNCTUATION = /[。！？，,!?]/;

/** `00:15:03` and `12:30` are timestamps. A cast list does not have a character called 12. */
const NUMERIC_LABEL = /^\d+$/;

/** Rough shape of the glut rule: more than ~40 distinct labels in a 200-line paste is not a cast. */
const DISTINCT_LABEL_RATIO = 0.2;

/** ...but only past a floor, so a genuine crowd scene in a short paste is not condemned by a ratio. */
const MIN_DISTINCT_LABEL_BUDGET = 8;

/**
 * How many labelled lines it takes before "did the labels repeat?" is a question worth asking.
 *
 * Below it every paste answers "no" - `A: hi` / `B: yo` is two lines with two names, and it is a real
 * exchange. This is the only exemption from the repetition rule, and it is deliberately tiny: at three
 * labelled lines a paste that reuses nothing is already telling us what it is.
 */
const MIN_REPETITION_SAMPLE = 3;

/** Lines per distinct label that earns full credit. A cast list clears it easily; prose sits at 1. */
const FULL_CREDIT_LINES_PER_LABEL = 1.5;

/** An implausible match costs more than a plausible one earns - see {@link scoreSeparator}. */
const IMPLAUSIBLE_MATCH_WEIGHT = 1.5;

/**
 * Below this, `none` is the honest answer.
 *
 * It reads as "a separator has to explain at least a fifth of the paste". A novel excerpt with two
 * colons in six lines does not, and the wizard offering `none` for it is correct rather than a failure.
 */
const MIN_INFERENCE_SCORE = 0.2;

function isPlausibleSpeakerLabel(label: string): boolean {
  return (
    label.length <= MAX_PLAUSIBLE_LABEL_LENGTH &&
    !LABEL_SENTENCE_PUNCTUATION.test(label) &&
    !NUMERIC_LABEL.test(label)
  );
}

/**
 * How much of the paste a separator is credited with explaining, before repetition is weighed.
 *
 * Plausible matches earn 1 line of credit each, implausible ones *cost* {@link IMPLAUSIBLE_MATCH_WEIGHT}.
 * This is what makes a separator matching 90% of lines with names beat one matching 100% with sentence
 * fragments. The credit is divided by every line, matched or not, so a separator that explains four
 * lines out of forty scores 0.1 and loses to `none`.
 */
function coverageOf(plausible: number, implausible: number, lineCount: number): number {
  return (plausible - IMPLAUSIBLE_MATCH_WEIGHT * implausible) / lineCount;
}

/**
 * How much of that credit survives the question "did these labels come back?".
 *
 * A cast list reuses its names; prose does not, however name-shaped its clauses are. `He stopped at
 * the door` is short, clean, and never said again - and one-off labels used to be *free* below a
 * budget of eight, which handed any prose excerpt under ~40 lines a cast of up to eight ghosts. So the
 * ratio is a term in its own right rather than a damping applied at the tail:
 *
 *  - one line per label is prose, and scores 0 no matter how few labels there are;
 *  - {@link FULL_CREDIT_LINES_PER_LABEL} lines per label is a conversation, and keeps everything;
 *  - in between it scales, so a script with one walk-on part is weakened rather than condemned.
 *
 * The one exemption is {@link MIN_REPETITION_SAMPLE}: with two labelled lines nothing has had the
 * chance to repeat, and `A: hi` / `B: yo` is a real exchange.
 */
function repetitionCreditOf(matched: number, distinct: number): number {
  if (matched < MIN_REPETITION_SAMPLE) {
    return 1;
  }
  const linesPerLabel = matched / distinct;
  return Math.min(1, Math.max(0, (linesPerLabel - 1) / (FULL_CREDIT_LINES_PER_LABEL - 1)));
}

/**
 * How well one separator explains the paste, in roughly "share of lines accounted for" units.
 *
 * `coverage × repetition × glut`, every term about the labels rather than the hit count. The glut
 * damping stays for the case repetition alone cannot see: a 200-line paste whose 100 labels each
 * appear twice repeats perfectly well and is still not a cast list.
 *
 * Both dampings are multiplicative and applied only to a positive score: they weaken a claim, they
 * never turn a bad separator into a worse-than-nothing one twice over.
 */
function scoreSeparator(pattern: RegExp, raws: string[]): number {
  let plausible = 0;
  let implausible = 0;
  const distinct = new Set<string>();
  for (const raw of raws) {
    const matched = matchPattern(pattern, raw);
    if (!matched) {
      continue;
    }
    distinct.add(speakerMemoryKey(matched.speaker));
    if (isPlausibleSpeakerLabel(matched.speaker)) {
      plausible += 1;
    } else {
      implausible += 1;
    }
  }
  const matched = plausible + implausible;
  if (matched === 0) {
    return 0;
  }
  const coverage = coverageOf(plausible, implausible, raws.length);
  if (coverage <= 0) {
    return coverage;
  }
  const budget = Math.max(
    MIN_DISTINCT_LABEL_BUDGET,
    Math.round(raws.length * DISTINCT_LABEL_RATIO)
  );
  const glut = distinct.size <= budget ? 1 : (budget / distinct.size) ** 2;
  return coverage * repetitionCreditOf(matched, distinct.size) * glut;
}

/** Score the built-in separators against the text and return the one that best explains it. */
export function inferPasteSeparator(text: string): PasteSeparatorChoice {
  const raws = toPastedLines(text);
  if (raws.length === 0) {
    return { kind: "none" };
  }
  let best: { kind: BuiltinSeparatorKind; score: number } | null = null;
  for (const entry of BUILTIN_SEPARATORS) {
    const score = scoreSeparator(entry.pattern, raws);
    // Strictly greater, so a tie keeps the earlier - i.e. the declaration order of the union.
    if (!best || score > best.score) {
      best = { kind: entry.kind, score };
    }
  }
  return best && best.score >= MIN_INFERENCE_SCORE ? { kind: best.kind } : { kind: "none" };
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * A custom pattern, compiled without ever throwing.
 *
 * The author is typing this character by character next to a live preview, so `^(?<speaker>[` is not an
 * error state - it is the fourth keystroke of a correct pattern. Both failure modes are reported and
 * the split falls back to `none`, which keeps the preview showing the author's own text instead of
 * blanking it.
 *
 * The group check reads the source rather than a probe match, because a pattern that names both groups
 * and happens not to match the probe is still a *valid* pattern; only a pattern that cannot name them
 * at all is `missingGroups`.
 */
function compileSpeakerRegex(
  source: string
): { regex: RegExp } | { problem: PasteSeparatorProblem } {
  let regex: RegExp;
  try {
    regex = new RegExp(source);
  } catch {
    return { problem: "invalidRegex" };
  }
  if (!regex.source.includes("(?<speaker>") || !regex.source.includes("(?<text>")) {
    return { problem: "missingGroups" };
  }
  return { regex };
}

function matchCustomRegex(regex: RegExp, raw: string): SeparatorMatch | null {
  const matched = raw.match(regex);
  if (!matched?.groups) {
    return null;
  }
  const speaker = (matched.groups.speaker ?? "").trim();
  const text = (matched.groups.text ?? "").trim();
  // Same emptiness rule as the built-ins: a half-applied pattern produces narration, not a nameless
  // speaker the mapping table would then have to offer a row for.
  return speaker.length > 0 && text.length > 0 ? { speaker, text } : null;
}

function buildSplit(raws: string[], match: (raw: string) => SeparatorMatch | null): PasteSplit {
  const lines: PastedLine[] = [];
  const tallies: PasteSpeakerTally[] = [];
  const byKey = new Map<string, PasteSpeakerTally>();
  let narrationCount = 0;
  for (const raw of raws) {
    const index = lines.length;
    const matched = match(raw);
    if (!matched) {
      lines.push({ index, raw, text: raw });
      narrationCount += 1;
      continue;
    }
    lines.push({ index, raw, speaker: matched.speaker, text: matched.text });
    // Grouped by the memory key, labelled by the first spelling seen: `Alice` and `ALICE` are one
    // decision, and the author should not be asked it twice - nor see the table reshuffle when the
    // second spelling turns up on line 300.
    const key = speakerMemoryKey(matched.speaker);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.lineIndices.push(index);
    } else {
      const tally: PasteSpeakerTally = { label: matched.speaker, count: 1, lineIndices: [index] };
      byKey.set(key, tally);
      tallies.push(tally);
    }
  }
  return { lines, speakers: tallies, narrationCount };
}

/** Split pasted text into lines, applying one separator choice. Blank lines produce no line. */
export function splitPastedText(text: string, choice: PasteSeparatorChoice): PasteSplit {
  const raws = toPastedLines(text);
  if (choice.kind === "regex") {
    const compiled = compileSpeakerRegex(choice.source);
    if ("problem" in compiled) {
      return { ...buildSplit(raws, () => null), problem: compiled.problem };
    }
    return buildSplit(raws, (raw) => matchCustomRegex(compiled.regex, raw));
  }
  // `none` is the kind with no pattern, which is exactly the behaviour it asks for: every line stays
  // whole and becomes narration.
  const pattern = BUILTIN_SEPARATORS.find((entry) => entry.kind === choice.kind)?.pattern;
  return buildSplit(raws, (raw) => (pattern ? matchPattern(pattern, raw) : null));
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** Apply the author's speaker decisions to a split, yielding the rows a confirm would create. */
export function planPastedRows(input: PastePlanInput): PastePlan {
  // The tally's spelling wins over the line's own, for the same reason the tally groups by key: one
  // row in the mapping table must mean one name, or `ALICE` on line 12 would create a second
  // character next to the `Alice` the author actually approved.
  const canonicalLabels = new Map(
    input.split.speakers.map((tally) => [speakerMemoryKey(tally.label), tally.label])
  );
  const rows: PastePlanRow[] = [];
  const charactersToCreate: string[] = [];
  for (const line of input.split.lines) {
    if (line.speaker === undefined) {
      rows.push({ kind: "narration", text: line.text });
      continue;
    }
    const key = speakerMemoryKey(line.speaker);
    const label = canonicalLabels.get(key) ?? line.speaker;
    const target = input.mappings[key];
    // Unmapped defaults to a temp speaker, never to character creation: see `SpeakerMappingTarget`.
    if (target?.kind === "notASpeaker") {
      // `raw`, not `${label}: ${text}` - the author is undoing a false positive, so the line has to
      // come back exactly as they pasted it, including whatever spacing sat around the separator.
      rows.push({ kind: "narration", text: line.raw });
      continue;
    }
    if (target?.kind === "character" && target.characterId) {
      rows.push({ kind: "dialogue", text: line.text, characterId: target.characterId });
      continue;
    }
    if (target?.kind === "createCharacter") {
      if (!charactersToCreate.includes(label)) {
        charactersToCreate.push(label);
      }
      // `speakerName` rides along as well as `pendingCharacterName`: it is what
      // `materializePastedRows` falls back to if the character never got created, and it is inert
      // once `characterId` resolves (NarraLeaf ignores it then).
      rows.push({
        kind: "dialogue",
        text: line.text,
        speakerName: label,
        pendingCharacterName: label
      });
      continue;
    }
    rows.push({ kind: "dialogue", text: line.text, speakerName: label });
  }
  return { rows, charactersToCreate, counts: countRows(rows) };
}

/** The no-wizard path: every line becomes a row shaped by wherever the caret was. */
export function planPlainPaste(text: string, anchor: PlainPasteAnchor): PastePlan {
  // No separator is applied at all, deliberately: a plain paste that guessed speakers would be the
  // wizard with none of the wizard's ways to say "no, that is not a name".
  const rows: PastePlanRow[] = toPastedLines(text).map((raw) =>
    anchor.kind === "dialogue"
      ? {
          kind: "dialogue",
          text: raw,
          ...(anchor.characterId ? { characterId: anchor.characterId } : {}),
          ...(anchor.speakerName ? { speakerName: anchor.speakerName } : {})
        }
      : { kind: "narration", text: raw }
  );
  return { rows, charactersToCreate: [], counts: countRows(rows) };
}

function countRows(rows: PastePlanRow[]): PastePlan["counts"] {
  let dialogue = 0;
  let narration = 0;
  for (const row of rows) {
    if (row.kind === "dialogue") {
      dialogue += 1;
    } else {
      narration += 1;
    }
  }
  return { dialogue, narration };
}

// ---------------------------------------------------------------------------
// Materialisation
// ---------------------------------------------------------------------------

/**
 * Every id is asserted at the moment it is minted.
 *
 * `assertValidStoryEntityId` is otherwise only reached on *load*, so an id factory that returned
 * `block-1` would produce a paste that looks perfect, saves fine, and refuses to open tomorrow. One
 * assertion here converts that into a loud failure at the only moment anyone can still connect it to
 * a cause.
 */
function mintId(generateId: MaterializeContext["generateId"], label: string): string {
  const id = generateId();
  assertValidStoryEntityId(id, label);
  return id;
}

/** Turn a plan into real blocks. Ids are minted here, so this is the only step that is not pure. */
export function materializePastedRows(
  plan: PastePlan,
  context: MaterializeContext
): MaterializedPaste {
  const blocks: StoryBlock[] = plan.rows.map((row) => {
    const id = mintId(context.generateId, "Story block id");
    // A fresh `textId` per row, never a reused one: it is the key rich-text runs, find/replace and
    // the voice map address a line by, and two rows sharing one would silently alias.
    const textId = mintId(context.generateId, "Story text id");
    const base = { id, parentId: null, childrenIds: [] };
    if (row.kind === "narration") {
      return {
        ...base,
        kind: "nodeAction",
        payload: { action: "narration", text: { textId, role: "narration", value: row.text } }
      };
    }
    const characterId =
      row.characterId ??
      (row.pendingCharacterName
        ? context.createdCharacterIds[row.pendingCharacterName]
        : undefined);
    // A pending name that is not in the map means the confirm step did not create it (the author
    // backed out, or the character service refused). Falling back to the bare name keeps the line
    // readable and correct; writing the unresolved id would leave a dialogue row pointing at a
    // character that does not exist, which nothing downstream can repair.
    const speakerName = characterId ? undefined : (row.speakerName ?? row.pendingCharacterName);
    return {
      ...base,
      kind: "nodeAction",
      payload: {
        action: "dialogue",
        ...(characterId ? { characterId } : {}),
        ...(speakerName ? { speakerName } : {}),
        text: { textId, role: "dialogue", value: row.text }
      }
    };
  });
  return { blocks };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * The `kind` Studio's own story clipboard payload carries.
 *
 * Duplicated from `storySceneClipboard.ts` rather than imported, so this model stays free of the
 * editor app it serves. If the two ever disagree the symptom is loud (a copy inside Studio starts
 * opening the wizard), which is the failure mode a duplicated literal is allowed to have.
 */
export const STORY_ACTIONS_CLIPBOARD_KIND = "narraleaf.story.actions";

function isStoryBlocksPayload(raw: string): boolean {
  if (!raw.trim()) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; roots?: unknown };
    return (
      parsed?.kind === STORY_ACTIONS_CLIPBOARD_KIND &&
      Array.isArray(parsed.roots) &&
      parsed.roots.length > 0
    );
  } catch {
    return false;
  }
}

/** Decide which of the five paste paths a clipboard payload takes. */
export function routeStoryPaste(input: {
  storyBlocksPayload: string;
  plainText: string;
  plainRequested: boolean;
}): StoryPasteRoute {
  // Order is the whole content of this function. Blocks first because a copy from Studio must never
  // be reinterpreted as prose; the script header next because a Story Script's `#data` footer would
  // otherwise bury a scene under its own serialisation (and `#nlscript` alone is also a single line,
  // so it has to outrank `single` too).
  if (isStoryBlocksPayload(input.storyBlocksPayload)) {
    return { kind: "blocks" };
  }
  if (input.plainText.trimStart().startsWith(STORY_SCRIPT_HEADER)) {
    return { kind: "scriptFile" };
  }
  // Zero lines lands here as well: an empty paste has nothing for either the wizard or the plain path
  // to do, and the single-line path already inserts nothing gracefully.
  if (toPastedLines(input.plainText).length <= 1) {
    return { kind: "single" };
  }
  return input.plainRequested
    ? { kind: "plain", text: input.plainText }
    : { kind: "wizard", text: input.plainText };
}

/** The key {@link StoryPasteMemory.speakers} and `PastePlanInput.mappings` are both keyed by. */
export function speakerMemoryKey(label: string): string {
  return label.trim().toLowerCase();
}
