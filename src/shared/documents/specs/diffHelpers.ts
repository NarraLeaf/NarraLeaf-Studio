import { DocumentChange, DocumentChangeKind } from "../diff";

/**
 * The parts every semantic diff turns out to need, and nothing a single format could own.
 *
 * Three specs (story, assets-metadata, characters) all reduce to the same two operations: line two
 * keyed collections up by id, and ask whether two values are the same value. Written once because
 * the alternative is three subtly different notions of "same" - one of which will decide that a
 * document nobody touched changed, on some machines only.
 *
 * Everything here is pure and total. `spec.diff` is contractually not allowed to throw, and these
 * run on documents that came out of a repository rather than out of an editor, so they are handed
 * shapes no current Studio would write.
 */

/**
 * Structural equality over JSON values.
 *
 * Not `JSON.stringify(a) === JSON.stringify(b)`: that answer depends on key insertion order, so two
 * objects with the same contents built by different code paths - a migration and an editor, which is
 * exactly the pair a diff compares - would come back different, and every affected row would be
 * reported as a change the author never made.
 *
 * `Object.is` at the leaves for the reason `canonicalJson` preserves `-0`: a document that held `-0`
 * and now holds `0` really is two different files.
 */
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((element, index) => sameJsonValue(element, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  // `hasOwnProperty` rather than `right[key] !== undefined`: a key present and explicitly
  // undefined cannot come from JSON, but it can come from an in-memory document, and treating it
  // as absent would call two different documents equal.
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) && sameJsonValue(left[key], right[key])
  );
}

/** One key of a keyed collection, and which sides hold it. */
export interface KeyedEntry<T> {
  readonly key: string;
  readonly base: T | undefined;
  readonly head: T | undefined;
  readonly kind: DocumentChangeKind;
}

/**
 * Line two keyed collections up by key, dropping the keys that did not change.
 *
 * This is the whole reason a semantic diff beats the structural tier on these formats, and it is
 * free rather than clever: scenes, blocks, assets and avatars are all stored keyed by a generated
 * id, so "the same thing on both sides" is already written down. The structural walk cannot use it -
 * it sorts keys and compares positionally inside arrays - which is why one asset imported at the
 * front of a list reads there as every asset after it changing.
 *
 * Order is the union of both sides' keys, sorted, so the result is the same on every run and on both
 * machines. Callers that want a friendlier order (by the author's own name, say) re-sort the rows
 * they build; they must not re-sort after truncating, which is what `buildDocumentDiff` is for.
 */
export function diffKeyed<T>(
  base: Readonly<Record<string, T>> | undefined,
  head: Readonly<Record<string, T>> | undefined
): KeyedEntry<T>[] {
  const left = base ?? {};
  const right = head ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();

  const entries: KeyedEntry<T>[] = [];
  for (const key of keys) {
    const inBase = Object.prototype.hasOwnProperty.call(left, key);
    const inHead = Object.prototype.hasOwnProperty.call(right, key);
    if (inBase && inHead) {
      if (!sameJsonValue(left[key], right[key])) {
        entries.push({ key, base: left[key], head: right[key], kind: "changed" });
      }
      continue;
    }
    entries.push({
      key,
      base: inBase ? left[key] : undefined,
      head: inHead ? right[key] : undefined,
      kind: inBase ? "removed" : "added"
    });
  }
  return entries;
}

/** The same, for a list whose elements carry their own id. Elements without one are skipped. */
export function byId<T extends { id?: unknown }>(
  list: readonly T[] | undefined
): Record<string, T> {
  const record: Record<string, T> = {};
  for (const element of list ?? []) {
    const id = element?.id;
    if (
      typeof id === "string" &&
      id.length > 0 &&
      !Object.prototype.hasOwnProperty.call(record, id)
    ) {
      record[id] = element;
    }
  }
  return record;
}

/**
 * How much of a value is quoted into a label parameter.
 *
 * Same ceiling and the same reason as the structural tier's: a parameter exists so a row can say
 * `0.8 -> 0.9` without a second read, not so a scene's whole text crosses IPC two hundred times.
 */
export const DIFF_VALUE_PREVIEW_CHARS = 80;

/** A short, single-line rendering of a scalar. Containers answer `undefined` - see `describe` in the structural tier. */
export function previewValue(value: unknown): string | undefined {
  if (value === undefined || (typeof value === "object" && value !== null)) {
    return undefined;
  }
  const text = typeof value === "string" ? value : String(value);
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) {
    return undefined;
  }
  return flat.length > DIFF_VALUE_PREVIEW_CHARS
    ? `${flat.slice(0, DIFF_VALUE_PREVIEW_CHARS)}…`
    : flat;
}

/** `{from, to}` for a label's parameters, leaving out whichever side has nothing quotable. */
export function fromToParams(base: unknown, head: unknown): Record<string, string | number> {
  const from = previewValue(base);
  const to = previewValue(head);
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to })
  };
}

/**
 * A trimmed authored name, or undefined.
 *
 * `subject` is defined as the author's own text and nothing else, so anything that is not a
 * non-empty string the author typed has to come back undefined rather than as `"(unnamed)"` or as an
 * id - both of which the surface would print verbatim beside a translated label, as if the author
 * had written them.
 */
export function authoredName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Order rows by their path, so a list built from a map is the same list on every run. */
export function comparePaths(a: DocumentChange, b: DocumentChange): number {
  const left = a.path.join("/");
  const right = b.path.join("/");
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Build a row, dropping `subject` and `children` when there is nothing to put in them.
 *
 * The dropping is not tidiness: `children: []` is a group with no children, which
 * `countDocumentChanges` counts as zero and `buildDocumentDiff` therefore keeps for free while
 * showing the author nothing. A row with nothing under it has to be a leaf.
 */
export function change(
  path: readonly string[],
  kind: DocumentChangeKind,
  key: string,
  options: {
    params?: Record<string, string | number>;
    subject?: string;
    children?: readonly DocumentChange[];
  } = {}
): DocumentChange {
  const params =
    options.params && Object.keys(options.params).length > 0 ? options.params : undefined;
  return {
    path,
    kind,
    label: { key, ...(params ? { params } : {}) },
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.children && options.children.length > 0 ? { children: options.children } : {})
  };
}
