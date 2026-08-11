import type { ComponentType } from "react";
import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import { genericChangePresenter } from "./GenericChangeDetail";

/**
 * Who draws the detail half of a comparison, and how a format takes that job over.
 *
 * The change model is one shape for every format on purpose (see `shared/documents/diff.ts`), and a
 * generic list of rows is the honest way to draw a format nobody has written anything better for.
 * But it is only ever the floor: a story's changed rows want to be read as script, a palette's as
 * swatches, a translation's as two strings side by side. A registry is what lets those arrive one at
 * a time without the tab learning about each of them.
 *
 * **Exactly one presenter is mounted at a time**, which is the constraint that keeps the detail pane
 * from becoming the stacked list this layout replaced. {@link presenterFor} answers with one
 * presenter and never with a set, and `ChangeDetailHost` renders that one.
 */

export interface ChangePresenterProps {
    readonly entry: DocumentDiffEntry;
    /** The selected change; absent means the selection is the whole document. */
    readonly change?: DocumentChange;
}

export interface ChangePresenter {
    /** Stable, and unique among registered presenters. Drawn nowhere; used to identify one. */
    readonly id: string;
    /**
     * Whether this presenter can draw that document.
     *
     * Answered from the entry alone - normally its `documentKind` - and must be pure and cheap: it
     * is asked once per selection, and a `matches` that reads the diff to decide would make the
     * choice of presenter depend on what changed rather than on what the file is.
     */
    matches(entry: DocumentDiffEntry): boolean;
    readonly Detail: ComponentType<ChangePresenterProps>;
}

/**
 * Registered presenters, most recent last.
 *
 * Consulted in reverse, so a presenter registered later wins over an earlier one that also matches.
 * That ordering is what makes registration composable: a plugin, or a milestone that adds a better
 * presenter for a format that already had one, does not have to unregister anything.
 */
const presenters: ChangePresenter[] = [];

export function registerChangePresenter(presenter: ChangePresenter): void {
    const existing = presenters.findIndex(candidate => candidate.id === presenter.id);
    if (existing >= 0) {
        // Replaced rather than appended: a module evaluated twice (a hot reload, a bundler fault)
        // would otherwise leave two presenters answering to one id, and which of them draws would
        // depend on registration order rather than on anything anyone decided.
        presenters.splice(existing, 1);
    }
    presenters.push(presenter);
}

/**
 * The presenter for one document. **Never undefined.**
 *
 * A format nobody has claimed falls back to the generic list, which can draw any
 * {@link DocumentDiffEntry} there is - so the detail pane has something to show for every file in
 * the comparison rather than a blank half-screen for the ones nobody has got to yet.
 */
export function presenterFor(entry: DocumentDiffEntry): ChangePresenter {
    for (let index = presenters.length - 1; index >= 0; index -= 1) {
        if (presenters[index].matches(entry)) {
            return presenters[index];
        }
    }
    return genericChangePresenter;
}

/** The registered presenters, for tests and for anything that wants to list what is installed. */
export function listChangePresenters(): readonly ChangePresenter[] {
    return presenters;
}
