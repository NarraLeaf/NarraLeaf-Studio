import { useMemo } from "react";
import type { DocumentChange } from "@shared/documents/diff";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { EmptyState, SectionCard } from "@/lib/components/elements";
import { DocumentChangeList } from "../DocumentChangeList";
import {
    CHANGE_KIND_GLYPH,
    CHANGE_KIND_TINT,
    documentDiffEmptyKey,
    isWholeDocumentChange,
    resolveDocumentChangeLabel,
} from "../documentChangeView";
import { DOCUMENT_ROW_CEILING, GenericChangeDetail } from "./GenericChangeDetail";
import { registerChangePresenter, type ChangePresenter, type ChangePresenterProps } from "./registry";
import { buildSettingsSections, isSettingsEntry } from "./settingsSections";

/**
 * A settings document, area by area.
 *
 * Seven of the project's documents are settings - its own configuration, the build variants, the
 * audio buses, the variables, the save fields, the dictionary and the palette - and each of them
 * now reports what an author actually changed rather than a byte count. What they did NOT have is
 * anywhere to say it: the detail pane drew them as the same unadorned list the version rail used to
 * draw in a 320px column, four words wide in the middle of an empty half-screen, which reads as a
 * surface that has nothing to say about a file it understands well.
 *
 * So the rows are put in cards, and the cards are the document's own areas: the project's settings
 * are reported as one group per panel an author edits them in - network access, player defaults,
 * saving - and each group becomes a card holding the settings inside it, with the two values on
 * each row. Nothing about a row changes; `DocumentChangeList` draws them here exactly as it draws
 * them anywhere else, so what a change SAYS has one implementation and one wording.
 *
 * **Only the semantic tier is drawn as cards.** A structural comparison of the same file is a list
 * of JSON paths that happens to be shaped like settings and is a much weaker claim - and it comes
 * with a caption saying so, which the generic list already states once and in the right place. The
 * same goes for a file that was added, removed or moved, and for a single change selected out of
 * the document: one card with one row in it says less than the row does. All four fall through to
 * the generic list, which is the floor for every format and stays reachable from here.
 */

export function SettingsChangeDetail({ entry, change }: ChangePresenterProps) {
    const translator = useTranslation();
    const { t } = translator;
    const { sections, hidden, total } = useMemo(
        () => buildSettingsSections(entry.diff, DOCUMENT_ROW_CEILING),
        [entry.diff],
    );

    // Cards claim that the rows under them are settings an author recognises. Only tier one can
    // support that, and only for the whole document; see the note above.
    const sectioned = change === undefined
        && entry.diff.tier === "semantic"
        && !isWholeDocumentChange(entry.kind);

    if (!sectioned) {
        return <GenericChangeDetail entry={entry} change={change} />;
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
                    // What the document called this area, or empty for the run it did not name. The
                    // one handle a test has on which cards a pane is made of, and what tells someone
                    // reading the DOM which settings they are looking at.
                    data-settings-section={section.heading ? section.heading.path.join("/") : ""}
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

/**
 * What a card is called.
 *
 * It carries the group's marker as well as its name, because a settings area that appeared or went
 * away is a change in its own right and the row it used to be drew that marker. A heading without
 * one would be the single fact a card loses by being a card.
 *
 * Exported because the cast's cards are headed the same way and by the same rule - the change
 * that names a card, drawn as one row would be drawn. A second copy of it would be a second
 * place a heading can stop wearing its marker.
 */
export function SectionHeading({ change }: { change: DocumentChange }) {
    const translator = useTranslation();
    const label = resolveDocumentChangeLabel(change, translator);
    const path = change.path.join(" / ");

    return (
        <span className="flex min-w-0 items-baseline gap-1.5" data-tip={path || undefined}>
            <span
                aria-hidden
                className={cn("w-2 shrink-0 text-center font-mono", CHANGE_KIND_TINT[change.kind])}
            >
                {CHANGE_KIND_GLYPH[change.kind]}
            </span>
            <span className="min-w-0 truncate text-fg-muted">{label.primary}</span>
            {label.detail && <span className="min-w-0 shrink truncate">{label.detail}</span>}
        </span>
    );
}

export const settingsChangePresenter: ChangePresenter = {
    id: "settings",
    matches: isSettingsEntry,
    Detail: SettingsChangeDetail,
};

// Registered on import, and imported for that effect by `ChangeDetailHost`. A presenter that is
// only exported is a presenter nobody ever sees.
registerChangePresenter(settingsChangePresenter);
