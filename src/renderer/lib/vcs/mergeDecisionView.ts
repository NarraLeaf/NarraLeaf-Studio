import type { DocumentMergeDecision, DocumentMergeSide } from "@shared/documents/diff";
import { mergeDecisionKey, type DocumentMergeSideName } from "@shared/documents/mergeApply";
import type { TranslationKey } from "@shared/i18n";
import type {
  VcsMergeDocument,
  VcsMergeDocumentBlocker,
  VcsMergeSideChoice
} from "@shared/types/vcs";
import type { LabelTranslator } from "./documentChangeView";

/**
 * Reading a three-way merge's decisions as rows, without a component in the picture.
 *
 * The same split `documentChangeView.ts` makes and for the same reason: there are no
 * component-render tests here, so everything that can be WRONG about the second tier - which side
 * a row is currently on, whether a file is finished, what a value looks like when it is an object,
 * which sentence a refusal gets - lives in functions that can be called without mounting anything.
 *
 * One rule runs through all of it. **A `conflict` with no recorded choice is not "mine" and not
 * "theirs" and must never resolve to either**. Two hundred
 * conflicts to click through is tedious; one mis-aimed press that silently discarded a
 * collaborator's day is worse, and unlike the tedium it leaves no trace.
 */

/** The author's choices inside one document, keyed by {@link mergeDecisionKey}. */
export type MergeChangeChoices = Readonly<Record<string, VcsMergeSideChoice>>;

/**
 * The side a row is on right now: the author's choice, else the one the merge already took.
 *
 * `undefined` only for an unanswered `conflict`, which is the state the finish button counts.
 */
export function effectiveMergeSide(
  decision: DocumentMergeDecision,
  choices: MergeChangeChoices
): DocumentMergeSideName | undefined {
  const chosen = choices[mergeDecisionKey(decision.path)];
  if (chosen) {
    return chosen;
  }
  if (decision.outcome === "auto-mine") return "mine";
  if (decision.outcome === "auto-theirs") return "theirs";
  return undefined;
}

/** Conflicts in this document the author has not answered. Zero means it can be finished. */
export function countUndecidedChanges(
  decisions: readonly DocumentMergeDecision[],
  choices: MergeChangeChoices
): number {
  let count = 0;
  for (const decision of decisions) {
    if (effectiveMergeSide(decision, choices) === undefined) {
      count += 1;
    }
  }
  return count;
}

/**
 * What one window knows about one conflicted document's insides.
 *
 * Read on demand - a decision carries BOTH sides' values verbatim, so a merge with two hundred
 * conflicted files fetched up front would be a message almost none of which is ever looked at.
 * `undefined` for a path nobody has opened, which is a fourth state and the one that decides
 * whether the per-change control may be offered at all.
 */
export type MergeDocumentEntry =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly document: VcsMergeDocument };

/**
 * Everything a window has decided about a merge, and everywhere it exists.
 *
 * Nothing readable says which conflicts an author has already settled (docs §4.24), so this record
 * belongs to the window drawing it and is never presented as repository state. Read-only here: this
 * module answers questions about the choices and records none.
 */
export interface MergeChoiceState {
  /** Whole-file choices, keyed by repository-relative path. Absent means undecided. */
  readonly decisions: Readonly<Record<string, VcsMergeSideChoice>>;
  /**
   * Paths being settled change by change.
   *
   * Separate from {@link changeChoices}, because "this file is being merged" and "this change goes
   * to theirs" are different facts: a document whose every inner change merged automatically has
   * nothing to choose and still has to be marked as merged.
   */
  readonly perChange: Readonly<Record<string, true>>;
  readonly changeChoices: Readonly<Record<string, MergeChangeChoices>>;
  readonly documents: Readonly<Record<string, MergeDocumentEntry>>;
}

/** The answer a file has, or `none` - which is the state that stops the merge being finished. */
export type MergeFileDecision = VcsMergeSideChoice | "per-change" | "none";

/** One conflicted file, as the index draws it and as the finish button counts it. */
export interface ConflictRowView {
  readonly path: string;
  readonly decision: MergeFileDecision;
  /**
   * Whether this file has an answer the author gave.
   *
   * The one predicate behind both the row's marker and the finish button, so the two cannot
   * disagree about whether a merge can be closed.
   */
  readonly settled: boolean;
  /**
   * Whether this file may be settled change by change.
   *
   * False until the document has been READ, because that is a property of the document and not of
   * the interface: the control cannot be drawn before anyone has looked (see
   * {@link VcsMergeDocument.blocked}, which is the other half of the answer).
   */
  readonly mergeable: boolean;
  /** Conflicts inside it still needing a side. Zero for anything not being merged per change. */
  readonly undecidedChanges: number;
}

export function buildConflictRows(
  paths: readonly string[],
  state: MergeChoiceState
): ConflictRowView[] {
  return paths.map((path) => {
    const whole = state.decisions[path];
    const entry = state.documents[path];
    const document = entry?.status === "ready" ? entry.document : null;
    const mergeable = document !== null && document.blocked === undefined;
    const merging = state.perChange[path] === true;
    const undecidedChanges =
      mergeable && merging
        ? countUndecidedChanges(document.decisions, state.changeChoices[path] ?? {})
        : 0;
    return {
      path,
      decision: whole ?? (merging ? "per-change" : "none"),
      // Per-change counts only when every `conflict` inside has a side; an `auto-*` row needs
      // nothing, because the merge already had a right answer for it. A blocked document can
      // never be settled this way, however many changes it reports.
      settled: whole !== undefined || (merging && mergeable && undecidedChanges === 0),
      mergeable,
      undecidedChanges
    };
  });
}

/** Files still needing an answer. Counted over every conflict, not over the rows an index drew. */
export function countUndecidedFiles(rows: readonly ConflictRowView[]): number {
  return rows.reduce((count, row) => (row.settled ? count : count + 1), 0);
}

/**
 * One decision, read out loud.
 *
 * `label` is optional on the model and its absence is a real state, not a gap: a format whose merge
 * lands before its semantic diff has no vocabulary yet. **The fallback is the path itself, drawn as
 * the raw thing it is** - inventing a sentence here would put a translated-looking label on a row
 * nobody has words for, which is worse than an obviously untranslated one because it cannot be
 * spotted.
 */
export interface MergeDecisionLabelView {
  /** The row's leading text: the author's own word where there is one, else the translated label. */
  readonly primary: string;
  /** The translated label, when {@link primary} is the subject. */
  readonly detail?: string;
  /** True when {@link primary} is a path rather than anything anyone wrote or translated. */
  readonly untranslated: boolean;
}

export function resolveMergeDecisionLabel(
  decision: DocumentMergeDecision,
  translator: LabelTranslator
): MergeDecisionLabelView {
  if (!decision.label) {
    return {
      primary: decision.subject ?? decision.path.join(" / "),
      untranslated: decision.subject === undefined
    };
  }
  // Cast for `resolveDocumentChangeLabel`'s reason: a producer's key is a plain string by
  // contract, and one with no entry renders as itself rather than as nothing.
  const text = translator.t(decision.label.key as TranslationKey, { ...decision.label.params });
  return decision.subject === undefined
    ? { primary: text, untranslated: false }
    : { primary: decision.subject, detail: text, untranslated: false };
}

/** How many fields of one side's value a row draws before it says how many it left out. */
export const MERGE_VALUE_FIELD_LIMIT = 4;

/** Longest one field's text may be before it is cut. Two of these sit side by side in one row. */
export const MERGE_VALUE_TEXT_LIMIT = 160;

/** One line of a side's value: a field name where there is one, and its text. */
export interface MergeValueLine {
  readonly name?: string;
  readonly text: string;
}

/**
 * What one side holds, as lines.
 *
 * **Fields, not JSON.** A decision is taken on one entry of a keyed collection, so the value is a
 * record - a translation unit, an asset's metadata - and the question the author is answering is
 * which of two `target` strings to keep. Printing `{"target":"你好","status":"translated",…}` puts
 * the answer inside punctuation; one line per field puts the two translations opposite each other,
 * which is the act of choosing.
 *
 * Nothing is filtered by name. A heuristic that promoted "the important field" would be inventing
 * an opinion about formats this module does not know, and the field it dropped would be the one
 * that mattered.
 *
 * `absent` is its own state and not an empty list: "the other side does not have this entry" is a
 * real answer to a merge and taking that side deletes it.
 */
export interface MergeValueView {
  readonly absent: boolean;
  readonly lines: readonly MergeValueLine[];
  /** Fields past {@link MERGE_VALUE_FIELD_LIMIT}. Non-zero obliges the row to say so. */
  readonly hidden: number;
}

export function describeMergeSide(side: DocumentMergeSide): MergeValueView {
  if (!side.present) {
    return { absent: true, lines: [], hidden: 0 };
  }
  const value = side.value;
  if (value === null || typeof value !== "object") {
    return { absent: false, lines: [{ text: scalarText(value) }], hidden: 0 };
  }
  const entries = Array.isArray(value)
    ? value.map((element, index) => [String(index), element] as const)
    : Object.entries(value as Record<string, unknown>);
  const lines = entries.slice(0, MERGE_VALUE_FIELD_LIMIT).map(([name, element]) => ({
    name,
    text: scalarText(element)
  }));
  return { absent: false, lines, hidden: Math.max(0, entries.length - lines.length) };
}

/**
 * One field as text.
 *
 * A nested object collapses to compact JSON rather than to a placeholder: it is rare in these
 * formats, and "{…}" would tell the author the two sides differ somewhere they cannot see.
 */
function scalarText(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value === undefined
        ? ""
        : (JSON.stringify(value) ?? String(value));
  return text.length > MERGE_VALUE_TEXT_LIMIT
    ? `${text.slice(0, MERGE_VALUE_TEXT_LIMIT - 1)}…`
    : text;
}

/**
 * Why one document has no per-change list - one sentence per wall, never a missing control.
 *
 * Plan §4.2's third tier is "refuse and say why", and this is the whole of the saying. A surface
 * that omitted the row for a blocked document would draw "Studio cannot merge this format" and
 * "there is nothing left to decide here" as the same blank space, and the author's only way to
 * tell them apart would be to finish the merge and look at the file.
 */
export function mergeDocumentBlockedKey(blocker: VcsMergeDocumentBlocker): TranslationKey {
  switch (blocker) {
    case "no-spec":
      return "documentDiff.resolve.change.blocked.noSpec" as TranslationKey;
    case "no-merge3":
      return "documentDiff.resolve.change.blocked.noMerge3" as TranslationKey;
    case "read-only":
      return "documentDiff.resolve.change.blocked.readOnly" as TranslationKey;
    case "too-large":
      return "documentDiff.resolve.change.blocked.tooLarge" as TranslationKey;
    case "too-many":
      return "documentDiff.resolve.change.blocked.tooMany" as TranslationKey;
    case "unreadable":
      return "documentDiff.resolve.change.blocked.unreadable" as TranslationKey;
  }
}
