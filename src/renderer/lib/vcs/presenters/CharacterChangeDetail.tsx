import { useMemo } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { useTranslation } from "@/lib/i18n";
import { EmptyState, SectionCard } from "@/lib/components/elements";
import { DocumentChangeList } from "../DocumentChangeList";
import { documentDiffEmptyKey, isWholeDocumentChange } from "../documentChangeView";
import { DOCUMENT_ROW_CEILING, GenericChangeDetail } from "./GenericChangeDetail";
import { SectionHeading } from "./SettingsChangeDetail";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { buildCharacterSections, isCharacterEntry, nameCharacterFields } from "./characterSections";

/**
 * The cast, character by character.
 *
 * The cast has had a semantic comparison since it became a document - "Alice's angry differential
 * points at a different image", said in the author's own words rather than as
 * `characters[3].profile.appearance.layers[2].options.t4k` - and nowhere to say it. The detail pane
 * drew it as the same unadorned list every unclaimed format gets: forty rows in one column, each
 * one repeating the name of the character it belongs to, with nothing to say which character an
 * author is looking at.
 *
 * So the rows are put in cards, and a card is a character. The heading is the author's own name for
 * them, carrying the marker their row wore, and the body is what moved inside them. What is left is
 * the cast itself - its order, the characters who arrived or left - and the groups, and each of
 * those becomes a run of its own rather than being scattered between the cards.
 *
 * Nothing about a row changes: `DocumentChangeList` draws them here exactly as it draws them
 * anywhere else, so what a change SAYS has one implementation and one wording. The one thing this
 * pane does to a row is give its `{field}` parameter the word the character editor uses for that
 * field, which `characterSections.ts` owns and explains.
 *
 * **No pictures.** Half of what this document holds is references to images - a pose's sprite, a
 * layer's art for one tag, a baked dialogue avatar - and a comparison of two of those would be
 * worth more than a row saying one changed. It is not here because the change model does not carry
 * the asset ids: a leaf names the pose and the path it sits at, and turning that into two pictures
 * means reading the whole cast document from BOTH sides, resolving each id against that side's
 * asset library, and reading a blob per row. That is a presenter that reads three documents rather
 * than a field list, and a field list that is right is worth more than a picture that might be
 * today's.
 *
 * **Only the semantic tier is drawn as cards.** A structural comparison of the same file is a list
 * of JSON paths that happens to be shaped like a cast and is a much weaker claim - and it comes
 * with a caption saying so, which the generic list already states once and in the right place. The
 * same goes for a file that was added, removed or moved, and for a single change selected out of
 * the document: one card with one row in it says less than the row does. All four fall through to
 * the generic list, which is the floor for every format and stays reachable from here.
 */

export function CharacterChangeDetail({ entry, change }: ChangePresenterProps) {
    const { t } = useTranslation();

    // Applied to the whole document rather than only to what the cards draw, so a field reads the
    // same whether the author selected one change in the index or opened the file.
    const named = useMemo<DocumentDiffEntry>(
        () => ({ ...entry, diff: { ...entry.diff, changes: nameCharacterFields(entry.diff.changes, t) } }),
        [entry, t],
    );
    const selected = useMemo(
        () => (change === undefined ? undefined : nameCharacterFields([change], t)[0]),
        [change, t],
    );
    const { sections, hidden, total } = useMemo(
        () => buildCharacterSections(named.diff, DOCUMENT_ROW_CEILING),
        [named.diff],
    );

    // Cards claim that the rows under them are one character's. Only tier one can support that, and
    // only for the whole document; see the note above.
    const sectioned = change === undefined
        && entry.diff.tier === "semantic"
        && !isWholeDocumentChange(entry.kind);

    if (!sectioned) {
        return <GenericChangeDetail entry={named} change={selected} />;
    }

    if (sections.length === 0) {
        // The pane is the width of an editor, so what the list states in a grey line has room to be
        // stated as the state it is. The wording is still the tier's own - "only formatting changed"
        // and "no change visible in the editor" are different facts and neither is "no changes".
        return <EmptyState size="sm" title={t(documentDiffEmptyKey(entry.diff.tier))} />;
    }

    return (
        <div className="flex flex-col gap-2 py-1">
            {sections.map(section => (
                <SectionCard
                    key={section.key}
                    title={section.heading ? <SectionHeading change={section.heading} /> : undefined}
                    // Which character this card is, or which of the two unnamed runs it is. The one
                    // handle a test has on what a pane is made of, and what tells someone reading
                    // the DOM whose changes they are looking at.
                    data-character-section={section.key}
                >
                    {/* The cap was already spent across the pane, so this list draws what it was
                        given and states any shortfall the section itself carries. */}
                    <DocumentChangeList diff={section.diff} limit={section.diff.changes.length} />
                </SectionCard>
            ))}
            {hidden > 0 && (
                <p className="text-2xs text-fg-subtle">
                    {t("documentDiff.rows.showing", { shown: String(total - hidden), total: String(total) })}
                </p>
            )}
        </div>
    );
}

export const characterChangePresenter: ChangePresenter = {
    id: "characters",
    matches: isCharacterEntry,
    Detail: CharacterChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(characterChangePresenter);
