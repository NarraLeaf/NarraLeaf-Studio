import {
    countDocumentChanges,
    type DocumentChange,
    type DocumentDiff,
    type DocumentDiffEntry,
} from "@shared/documents/diff";
import type { DocumentKind } from "@shared/documents/types";

/**
 * Cutting one settings document's changes into the sections a pane can draw as cards.
 *
 * Nothing here renders anything, for the reason `documentChangeView.ts` renders nothing: what a
 * section IS, how a budget is spent across several of them and how many changes end up off screen
 * all decide behaviour, and behaviour has to be reachable without mounting a component.
 *
 * **The grouping is the change model's own, and it is the only one there is.** A
 * {@link DocumentChange} may carry `children`, which is a producer saying "these belong together
 * under this name" - the project's settings arrive as one such group per area of the project, each
 * holding the fields inside it. That is a section. Everything else is a change at the document's
 * root and is drawn as a row.
 *
 * **What is deliberately NOT used as a grouping key** is `subject`, and it is worth writing down
 * because it looks like one: the six keyed settings documents (build variants, audio buses,
 * variables, save fields, dictionary terms, palette colours) report a flat list whose rows all
 * carry the author's word for the thing that changed, so grouping by it would produce a card per
 * bus with the bus's name repeated on every row inside it - `subject` is defined as a per-row word
 * drawn BESIDE the label (`shared/documents/diff.ts`), not as a heading. The model carries no
 * heading for those runs and this does not invent one; they come out as one unnamed section, which
 * is a framed list and an honest one.
 */

/** Document formats whose changes are a flat list of settings. See {@link isSettingsEntry}. */
const SETTINGS_DOCUMENT_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
    // The project's own settings - the one document that arrives already grouped, one row per area.
    "project",
    "app-tags",
    "audio-tracks",
    "variables",
    "save-schema",
    "dictionary",
]);

/**
 * Whether this document's changes are settings.
 *
 * Answered from the document kind alone, which is what `ChangePresenter.matches` requires: reading
 * the diff would make the choice of presenter depend on what an author happened to edit, so one
 * version of a file would be drawn as cards and the next as a list.
 *
 * **`brand` is not here.** The palette has a presenter of its own and keeps it: two colours differ
 * by one character of hex and by nothing anybody can picture, so the question it answers - are
 * these the same colour - is one no list of rows can answer at any width. Everything ELSE about the
 * palette is settings-shaped, which is why `BrandChangeDetail` falls back to this presenter's body
 * when a side's bytes cannot be read and the swatches cannot be drawn.
 */
export function isSettingsEntry(entry: DocumentDiffEntry): boolean {
    return entry.documentKind !== undefined && SETTINGS_DOCUMENT_KINDS.has(entry.documentKind);
}

/** One card: what it is called, and the changes under it as a diff of its own. */
export interface SettingsSection {
    /** Stable within one list. Two sections can stand at the same path, so the index is in it. */
    readonly key: string;
    /**
     * The change that names this section, or null for a run the document did not name.
     *
     * It is the group row itself rather than a string, because the surface needs more than its
     * words: a settings area that appeared or went away wears the same marker every other change
     * in the comparison wears, and dropping it here would be the one fact the card loses by
     * becoming a card.
     */
    readonly heading: DocumentChange | null;
    /**
     * What to draw inside, ready for the same `DocumentChangeList` every other presenter uses.
     *
     * `total` counts every leaf the section stands for, including the ones the producer dropped
     * and the ones this budget left out, so the list states its own shortfall exactly as it would
     * anywhere else. `tier` is carried over unchanged - how a change was produced is a property of
     * the comparison, not of which card it landed in.
     */
    readonly diff: DocumentDiff;
}

export interface SettingsSectionList {
    readonly sections: SettingsSection[];
    /**
     * Leaves no card carries: whole sections the budget dropped, plus anything the producer counted
     * without building. Shortfalls INSIDE a section are not counted here - that section says so
     * itself - so the two statements cannot double up.
     */
    readonly hidden: number;
    /** Everything the diff stands for. Together with {@link hidden}, what an omission notice quotes. */
    readonly total: number;
}

/** A section before the budget is spent: what names it, what is in it, and what it stands for. */
interface Candidate {
    readonly heading: DocumentChange | null;
    readonly changes: DocumentChange[];
    /** Leaves this section accounts for, dropped children included. */
    readonly leaves: number;
}

/**
 * The sections of one document's changes, capped at `limit` ROWS across all of them.
 *
 * One budget for the pane rather than one per card, because the reason for the cap is unchanged
 * from the list this replaces: the rows are not virtualised, and a document may carry up to the
 * producer's whole budget of changes. Sections are taken in the order the producer put them in and
 * never re-sorted - that order is a decision the spec made (identity first, then the areas of the
 * project in the order an author meets them), and a second opinion about it here would quietly
 * reshuffle the rows the author is told are the important ones.
 *
 * A section that does not fit whole is kept with the rows that fit and reports the rest itself,
 * and nothing after it is drawn. Half a card is worth more than none: the author still learns that
 * the area changed.
 */
export function buildSettingsSections(diff: DocumentDiff, limit: number): SettingsSectionList {
    const candidates: Candidate[] = [];
    let loose: DocumentChange[] = [];

    const closeLoose = () => {
        if (loose.length > 0) {
            candidates.push({ heading: null, changes: loose, leaves: countDocumentChanges(loose) });
            loose = [];
        }
    };

    for (const change of diff.changes) {
        const children = change.children ?? [];
        if (children.length === 0) {
            // Including a group whose children were ALL dropped: it has nothing to put in a card,
            // and as a row it still says the area changed and how much of it is missing.
            loose.push(change);
            continue;
        }
        closeLoose();
        candidates.push({
            heading: change,
            changes: [...children],
            leaves: children.length + (change.truncated ?? 0),
        });
    }
    closeLoose();

    const sections: SettingsSection[] = [];
    let budget = Math.max(0, limit);
    let accounted = 0;

    for (let index = 0; index < candidates.length; index += 1) {
        if (budget <= 0) {
            break;
        }
        const candidate = candidates[index];
        const taken = Math.min(candidate.changes.length, budget);
        budget -= taken;
        accounted += candidate.leaves;
        const changes = candidate.changes.slice(0, taken);
        sections.push({
            key: `${index}:${(candidate.heading ?? candidate.changes[0]).path.join("/")}`,
            heading: candidate.heading,
            diff: {
                changes,
                complete: taken >= candidate.leaves,
                total: candidate.leaves,
                tier: diff.tier,
            },
        });
        if (taken < candidate.changes.length) {
            break;
        }
    }

    return { sections, hidden: Math.max(0, diff.total - accounted), total: diff.total };
}
