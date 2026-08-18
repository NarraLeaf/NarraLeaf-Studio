import type { DocumentDiffEntry } from "@shared/documents/diff";
import { contentClassOf, type ContentClass } from "@shared/vcs/contentClass";
import type { ComparisonSide, ComparisonSides } from "./comparisonSide";

/**
 * The two questions every presenter that shows a file has to answer before it draws anything:
 * what kind of file is this, and which side of the comparison holds it.
 *
 * Here rather than in each presenter because both answers are the same answer for all of them,
 * and because both are wrong in ways that look fine on screen: a presenter that reads the class
 * from the path alone declines every asset a real project holds, and one that reads the missing
 * side of a one-sided entry draws an empty frame where the honest answer is that the file is not
 * there.
 */

/**
 * What kind of thing this entry holds.
 *
 * The class comes off the entry, which is where the comparison put what it worked out - and for
 * the files that matter most it is the only place the answer exists at all: an asset's contents
 * live at `assets/content/<shard>/<shard>/<id>`, so there is no extension for a renderer to read.
 * The name is the fallback for an entry produced by something that did not classify it.
 */
export function contentClassOfEntry(entry: DocumentDiffEntry): ContentClass {
  return entry.contentClass ?? contentClassOf(entry.path);
}

/**
 * Which side of the comparison holds this file, given what happened to it.
 *
 * A one-sided entry gets one side and a null, and the null is the point: reading the side that
 * does not have the file is a read that can only fail, and drawing an empty frame beside the real
 * one would say the file is blank there rather than absent.
 *
 * A move is one-sided by the same logic in reverse: the pairing that produced it proved both sides
 * hold identical bytes, so there is nothing to compare and the file is drawn once.
 */
export function sidesOfEntry(
  entry: DocumentDiffEntry,
  sides: ComparisonSides | undefined
): { before: ComparisonSide | null; after: ComparisonSide | null } {
  if (!sides) {
    return { before: null, after: null };
  }
  switch (entry.kind) {
    case "added":
      return { before: null, after: sides.after };
    case "removed":
      return { before: sides.before, after: null };
    case "moved":
      return { before: null, after: sides.after };
    case "changed":
      return { before: sides.before, after: sides.after };
  }
}
