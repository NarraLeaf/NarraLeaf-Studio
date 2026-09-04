import {
    countDocumentChanges,
    type DocumentChange,
    type DocumentDiff,
    type DocumentDiffEntry,
} from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";

/**
 * Cutting the cast's changes into the cards a pane can draw, and naming the fields inside them.
 *
 * Nothing here renders anything, for the reason `settingsSections.ts` renders nothing: what a
 * section IS, how one budget is spent across several of them and how many changes end up off screen
 * all decide behaviour, and behaviour has to be reachable without mounting a component.
 *
 * **The grouping is the cast document's own shape.** `charactersDiff.ts` reports one row per
 * character, named by the character, with one leaf under it per thing that moved - plus a row for
 * the cast's order and a row per group. So a card is a character, its body is that character's
 * leaves, and the rows that are facts about the cast rather than about any one character are
 * collected into runs of their own.
 *
 * **The three runs are the document's own two top-level keys, not an opinion.** A character that
 * was added, removed, or changed in a way this diff does not detail carries no children, so a card
 * for it would be a heading over an empty body - it belongs on the list of what happened to the
 * cast. A group row is about `groups`, which is a different part of the document and reads as one.
 * Within each run the producer's order is kept exactly: it sorted the characters by the author's
 * own name, and a second opinion here would quietly reshuffle the rows.
 */

/** The cast document. Answered from the kind alone, which is what `ChangePresenter.matches` requires. */
export function isCharacterEntry(entry: DocumentDiffEntry): boolean {
    return entry.documentKind === "characters";
}

/** The top-level key a group row sits under; every other row is about the cast. */
const GROUP_ROOT = "groups";

/** The run of rows about the cast itself, drawn before the characters. */
export const CAST_SECTION_KEY = "cast";
/** The run of group rows, drawn after them. */
export const GROUP_SECTION_KEY = "groups";

/** One card: what it is called, and the changes under it as a diff of its own. */
export interface CharacterSection {
    /**
     * Stable within one list, and unique: `cast`, `groups`, or the character's own path.
     *
     * It reaches the DOM, so it is also the handle a test has on which cards a pane is made of.
     */
    readonly key: string;
    /**
     * The change that names this card, or null for a run the document did not name.
     *
     * It is the character's row rather than their name, because the surface needs more than the
     * word: a character that appeared or went away wears the same marker every other change in the
     * comparison wears, and dropping it here would be the one fact the card loses by becoming a
     * card.
     */
    readonly heading: DocumentChange | null;
    /**
     * What to draw inside, ready for the same `DocumentChangeList` every other presenter uses.
     *
     * `total` counts every leaf the section stands for, including the ones the producer dropped and
     * the ones this budget left out, so the list states its own shortfall exactly as it would
     * anywhere else. `tier` is carried over unchanged - how a change was produced is a property of
     * the comparison, not of which card it landed in.
     */
    readonly diff: DocumentDiff;
}

export interface CharacterSectionList {
    readonly sections: CharacterSection[];
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
    readonly key: string;
    readonly heading: DocumentChange | null;
    readonly changes: DocumentChange[];
    /** Leaves this section accounts for, dropped children included. */
    readonly leaves: number;
}

/**
 * The cards one cast comparison is made of, capped at `limit` ROWS across all of them.
 *
 * One budget for the pane rather than one per card, because the reason for the cap is unchanged
 * from the list this replaces: the rows are not virtualised, and a document may carry up to the
 * producer's whole budget of changes.
 *
 * A section that does not fit whole is kept with the rows that fit and reports the rest itself, and
 * nothing after it is drawn. Half a card is worth more than none: the author still learns that the
 * character changed.
 */
export function buildCharacterSections(diff: DocumentDiff, limit: number): CharacterSectionList {
    const cast: DocumentChange[] = [];
    const groups: DocumentChange[] = [];
    const characters: Candidate[] = [];

    for (const change of diff.changes) {
        const children = change.children ?? [];
        if (children.length === 0) {
            // Including a character whose children were ALL dropped: there is nothing to put in a
            // card, and as a row it still says the character changed and how much is missing.
            (change.path[0] === GROUP_ROOT ? groups : cast).push(change);
            continue;
        }
        characters.push({
            key: change.path.join("/"),
            heading: change,
            changes: [...children],
            leaves: children.length + (change.truncated ?? 0),
        });
    }

    const candidates: Candidate[] = [
        ...run(CAST_SECTION_KEY, cast),
        ...characters,
        ...run(GROUP_SECTION_KEY, groups),
    ];

    const sections: CharacterSection[] = [];
    let budget = Math.max(0, limit);
    let accounted = 0;

    for (const candidate of candidates) {
        if (budget <= 0) {
            break;
        }
        const taken = Math.min(candidate.changes.length, budget);
        budget -= taken;
        accounted += candidate.leaves;
        sections.push({
            key: candidate.key,
            heading: candidate.heading,
            diff: {
                changes: candidate.changes.slice(0, taken),
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

/** One unnamed run, or nothing at all when it has no rows - an empty card states nothing. */
function run(key: string, changes: DocumentChange[]): Candidate[] {
    if (changes.length === 0) {
        return [];
    }
    return [{ key, heading: null, changes, leaves: countDocumentChanges(changes) }];
}

/**
 * What the character editor calls each field the diff reports by its stored name.
 *
 * The producer hands back the field's key in the document - `defaultAvatarAssetId`, `voiceTrackId`,
 * `backend` - because it has no locale and no business holding one, and `documentDiff.characters`
 * spells the label as `Profile {field}`. Left alone, that puts a JSON key in front of the author on
 * a surface whose whole claim is that it says what they changed.
 *
 * So each of them is answered with the key the panel the author edits it in already uses: the
 * character properties schema for the profile fields
 * (`modules/properties/schemas/characterSchema.ts`), the puppet editor for a custom runtime's.
 *
 * **No word is coined here.** Six fields the editor draws without ever labelling - a character's
 * nicknames, the group a row was moved into, a layered appearance's canvas, its avatar axes and the
 * PSD it came from, and the state a puppet rests in - are named under
 * `documentDiff.characters.fields`, from the vocabulary the controls that reach them already use.
 * They are held there rather than beside the panel's own labels for the reason that block gives: a
 * word under `characters.*` that no panel draws would be read as the panel's own the next time
 * someone looks for one, and there would then be two of them.
 *
 * `attributes` and `options` are named in neither place. Studio has no surface for either - both are
 * bags a plugin or an import writes through - so their rows keep the stored name, which is the only
 * name anyone able to reach them has.
 */
export const CHARACTER_FIELD_NAME_KEY: Readonly<Record<string, TranslationKey>> = {
    // The profile, in the order the properties panel lists it.
    thumbnail: "characters.properties.thumbnail",
    color: "characters.properties.color",
    description: "common.description",
    tags: "characters.properties.tags",
    defaultAvatarAssetId: "characters.properties.defaultAvatar",
    voiceTrackId: "characters.properties.voiceTrack",
    entranceTransform: "characters.properties.entrance",
    portrait: "characters.preview.portraitTitle",
    // Two the panel shows without labelling: the nicknames printed under a name in the cast list,
    // and the group a row was moved into.
    nicknames: "documentDiff.characters.fields.nicknames",
    groupId: "documentDiff.characters.fields.group",
    // The appearance: the whole of it, the named combinations a layered one stores, and the four
    // fields a character drawn by a runtime is set up with.
    appearance: "characters.create.appearanceLabel",
    snapshots: "characters.editor.snapshots",
    assetId: "characters.editor.puppet.model",
    backend: "characters.editor.puppet.backend",
    entry: "characters.editor.puppet.entry",
    size: "characters.editor.puppet.size",
    // Four more the editor reaches through a button or an unlabelled control: the canvas declared
    // from the largest layer, the axes the dialog avatar varies with, the PSD a stack was imported
    // from, and the motion, expression and skin a puppet rests in.
    canvas: "documentDiff.characters.fields.canvas",
    avatarAxisIds: "documentDiff.characters.fields.avatarAxes",
    psd: "documentDiff.characters.fields.psd",
    defaultState: "documentDiff.characters.fields.puppetDefaultState",
};

/**
 * The same changes, with every `{field}` the editor has a word for replaced by that word.
 *
 * A rewritten parameter rather than a second way of drawing a row: what a change SAYS has one
 * implementation (`resolveDocumentChangeLabel`) and one wording, and a presenter that rendered its
 * own rows to fix a label would be a second one that drifts. Both levels are walked, because the
 * fields live on the leaves under a character.
 *
 * Changes with nothing to replace are returned as they are, so a row here and the same row anywhere
 * else in the comparison are the same object.
 */
export function nameCharacterFields(
    changes: readonly DocumentChange[],
    t: (key: TranslationKey) => string,
): DocumentChange[] {
    return changes.map(change => {
        const children = change.children === undefined ? undefined : nameCharacterFields(change.children, t);
        const field = change.label.params?.field;
        const key = typeof field === "string" ? CHARACTER_FIELD_NAME_KEY[field] : undefined;
        if (key === undefined) {
            return children === undefined ? change : { ...change, children };
        }
        return {
            ...change,
            ...(children === undefined ? {} : { children }),
            label: { ...change.label, params: { ...change.label.params, field: t(key) } },
        };
    });
}
