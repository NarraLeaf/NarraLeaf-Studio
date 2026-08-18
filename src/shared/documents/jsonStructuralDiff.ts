import {
  buildDocumentDiff,
  DocumentChange,
  DocumentChangeKind,
  DocumentChangeLabel,
  DocumentDiff
} from "./diff";

/**
 * A diff of two JSON values by structure alone, for documents no spec claims.
 *
 * Ten of the fifteen document kinds have no spec today - story among them - so without
 * this tier the first thing an author would see on opening a change is a blank list for
 * the biggest file in their project. What it costs is that nothing here knows what any
 * of these values MEAN: a reordered array of generated ids reads as a hundred changes,
 * and a renamed key reads as one removal plus one addition. That is the honest limit of
 * comparing structure, and {@link DocumentDiff.tier} is what carries the warning to the
 * surface - which is why every label key below is under `documentDiff.structural.`, a
 * namespace no semantic diff may borrow.
 *
 * Pure, no I/O, and no knowledge of Lore or of documents. It is shared rather than
 * main-only because the resolve flow will re-run it on bytes the renderer already holds.
 */

/** Every label this tier can produce. Generic by construction - see the note above. */
const LABEL_PROPERTY = "documentDiff.structural.property";
const LABEL_ELEMENT = "documentDiff.structural.element";
const LABEL_ROOT = "documentDiff.structural.root";

/**
 * How much of a value is quoted into a label parameter.
 *
 * A parameter carries the value so the surface can say `0.8 -> 0.9` without going back
 * for the document, and the cap is what stops that being a paragraph of a scene's text
 * crossing IPC for every one of two hundred rows.
 */
export const STRUCTURAL_VALUE_PREVIEW_CHARS = 80;

/** A key that is absent, told apart from one whose value is `null`. */
const ABSENT = Symbol("absent");
type Slot = unknown | typeof ABSENT;

interface Leaf {
  readonly group: string | undefined;
  readonly change: DocumentChange;
}

interface Group {
  key: string;
  changes: DocumentChange[];
  truncated: number;
}

/**
 * Compare two parsed JSON documents.
 *
 * Two properties hold and are pinned by tests:
 *
 *  - **Deterministic.** Object keys are walked in sorted order (the same UTF-16 code
 *    unit order `canonicalJson` writes them in), so the same pair of documents always
 *    produces the same list in the same order, whatever order the keys were built in.
 *  - **Ordered before truncated.** The walk visits in exactly the order the result is
 *    listed in, which is what lets it stop BUILDING changes at the limit while still
 *    COUNTING the rest: the rows that survive are the first ones in the final order, not
 *    the first ones that happened to be found. A walk whose order differed from the
 *    listing order could not do this, and taking the limit afterwards would keep an
 *    arbitrary subset.
 */
export function diffJsonStructural(
  base: unknown,
  head: unknown,
  options: { limit: number }
): DocumentDiff {
  const limit = Math.max(0, options.limit);
  const groups: Group[] = [];
  let built = 0;
  let total = 0;

  const emit = (leaf: Leaf): void => {
    total += 1;
    if (leaf.group === undefined) {
      // A change at the root itself - the two sides are not the same kind of value at
      // all. There is nothing to group it under and nothing below it.
      if (built < limit) {
        groups.push({ key: "", changes: [leaf.change], truncated: 0 });
        built += 1;
      }
      return;
    }

    const current = groups.length > 0 ? groups[groups.length - 1] : undefined;
    const sameGroup = current !== undefined && current.key === leaf.group;
    if (built < limit) {
      if (sameGroup) {
        current.changes.push(leaf.change);
      } else {
        groups.push({ key: leaf.group, changes: [leaf.change], truncated: 0 });
      }
      built += 1;
      return;
    }
    // Past the budget the walk keeps counting. A leaf belonging to the group that was
    // being filled when the budget ran out is recorded on it, so that group can say how
    // much of itself is missing; anything in a group that never started is covered by
    // `complete` and `total` on the diff.
    if (sameGroup) {
      current.truncated += 1;
    }
  };

  walk(base, head, [], emit);

  return buildDocumentDiff(groups.map(toChange), { tier: "structural", limit, total });
}

/**
 * One top-level key's changes, as a single row.
 *
 * The two-level shape of the model (document -> group -> leaf) mapped onto a JSON
 * document: the top-level key is the group, everything below it is a leaf of that group,
 * however deep it really sits. Deeper nesting is flattened rather than lost - a leaf
 * keeps its full path - because a rail 320px wide cannot draw a tree and a resolution
 * cannot be taken on a subtree.
 */
function toChange(group: Group): DocumentChange {
  const [first] = group.changes;
  if (group.changes.length === 1 && group.truncated === 0 && first.path.length <= 1) {
    return first;
  }
  return {
    path: [group.key],
    kind: "changed",
    ...labelFor(group.key, undefined, undefined),
    children: group.changes,
    ...(group.truncated > 0 ? { truncated: group.truncated } : {})
  };
}

function walk(base: Slot, head: Slot, path: (string | number)[], emit: (leaf: Leaf) => void): void {
  if (base === ABSENT && head === ABSENT) {
    return;
  }

  if (base === ABSENT || head === ABSENT) {
    const added = base === ABSENT;
    // Deliberately NOT descending into the added or removed value. One row saying "this
    // was added" is the change the author made; the alternative spends the whole budget
    // restating every field of one new object.
    emitLeaf(
      emit,
      path,
      added ? "added" : "removed",
      labelFor(path[path.length - 1], undefined, describe(added ? head : base))
    );
    return;
  }

  if (Array.isArray(base) && Array.isArray(head)) {
    // Positional, and that is all this tier offers: one element inserted at the front
    // reads as every element after it changing. Aligning two sequences by identity is
    // what a real `spec.diff` is for - it is the one thing here that cannot be done
    // without knowing what the elements ARE, since the id to match on is format
    // knowledge. Guessing an alignment (LCS over serialised elements) would produce a
    // confident wrong answer on exactly the documents that matter most.
    for (let index = 0; index < Math.max(base.length, head.length); index += 1) {
      path.push(index);
      walk(
        index < base.length ? base[index] : ABSENT,
        index < head.length ? head[index] : ABSENT,
        path,
        emit
      );
      path.pop();
    }
    return;
  }

  if (isPlainObject(base) && isPlainObject(head)) {
    // Sorted, so the walk order is the listing order (see the note on the export) and
    // so two runs over documents whose keys were built in different orders agree.
    const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
    for (const key of keys) {
      path.push(key);
      walk(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(head, key) ? head[key] : ABSENT,
        path,
        emit
      );
      path.pop();
    }
    return;
  }

  if (sameScalar(base, head)) {
    return;
  }

  emitLeaf(emit, path, "changed", labelFor(path[path.length - 1], describe(base), describe(head)));
}

function emitLeaf(
  emit: (leaf: Leaf) => void,
  path: readonly (string | number)[],
  kind: DocumentChangeKind,
  label: { label: DocumentChangeLabel; subject?: string }
): void {
  const first = path[0];
  emit({
    group: first === undefined ? undefined : String(first),
    change: {
      path: path.map(String),
      kind,
      ...label
    }
  });
}

/**
 * How one path segment is named, plus the values either side of the change.
 *
 * `subject` is the property name because at this tier the key IS the author's own word -
 * a localization key, a variable name, a field they chose - and it is the only thing on
 * the row that was not invented by Studio. An array index is not one, so it goes in the
 * label's parameters and nowhere else.
 */
function labelFor(
  segment: string | number | undefined,
  from: string | undefined,
  to: string | undefined
): { label: DocumentChangeLabel; subject?: string } {
  const values = {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to })
  };

  if (segment === undefined) {
    return { label: { key: LABEL_ROOT, ...(hasKeys(values) ? { params: values } : {}) } };
  }
  if (typeof segment === "number") {
    return { label: { key: LABEL_ELEMENT, params: { index: segment, ...values } } };
  }
  return { label: { key: LABEL_PROPERTY, params: { name: segment, ...values } }, subject: segment };
}

function hasKeys(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

/**
 * A short rendering of a value, or nothing for a container.
 *
 * Containers are deliberately left undefined rather than summarised as `{5 keys}`: that
 * would be a sentence this layer invented, in English, sitting in a field the surface
 * prints verbatim.
 */
function describe(value: unknown): string | undefined {
  if (value === ABSENT || (typeof value === "object" && value !== null)) {
    return undefined;
  }
  const text = typeof value === "string" ? value : String(value);
  return text.length > STRUCTURAL_VALUE_PREVIEW_CHARS
    ? `${text.slice(0, STRUCTURAL_VALUE_PREVIEW_CHARS)}…`
    : text;
}

/**
 * Whether two non-container values are the same value.
 *
 * `Object.is` rather than `===` for one reason that a document really can carry: the
 * canonical encoder preserves `-0`, so a document that held `-0` and now holds `0`
 * round-trips as two different files, and `===` would call that no change.
 */
function sameScalar(base: unknown, head: unknown): boolean {
  return Object.is(base, head);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
