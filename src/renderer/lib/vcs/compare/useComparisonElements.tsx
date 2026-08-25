import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { uiDocumentSpec } from "@shared/documents/specs/uiDocument";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { useWorkspace } from "@/apps/workspace/context";
import type { DocumentChangeRow } from "../documentChangeView";
import type { ComparisonSides } from "../presenters/comparisonSide";
import { sidesOfEntry } from "../presenters/entrySides";
import { useSideDocument } from "../presenters/sideDocument";
import {
    buildComparisonElementSelection,
    comparisonElementAddress,
    COMPARISON_ELEMENT_SELECTION_TYPE,
    isSameComparisonElement,
    type ComparisonElementSelection,
    type ComparisonHalf,
} from "./comparisonSelection";

/**
 * What a half does when a row in it is pressed: publish the element that row is about.
 *
 * The halves are not inert pictures. An author reading a comparison of a page of the interface asks
 * "what is this element now" about a row that says `layout` changed, and the answer is the element's
 * own fields - which the right rail already draws for every element in the project. So a row that
 * names an element becomes a control, and pressing it makes that element the app-wide selection at
 * the version its half is showing.
 *
 * **Only a UI document, for now.** A story row and a blueprint row address different things and are
 * a separate question; the blueprint editor has no right-rail inspector at all. A row of any other
 * kind stays exactly what it was - text, not a button - rather than becoming a control that does
 * nothing.
 *
 * **The documents are read once for the tab, not once per row.** Both halves are parsed anyway to be
 * drawn, and the selection carries the parsed element on to the rail, which has no way to read a
 * revision itself.
 */

/** What a half draws for one row, when that row selects something. */
export interface SplitRowAction {
    readonly onSelect: () => void;
    readonly selected: boolean;
    /** Named for the reader of a control, since the row's own text describes a change. */
    readonly label: string;
}

/** Answers `null` for a row that names no element in this half. */
export type SplitRowActionResolver = (row: DocumentChangeRow, half: ComparisonHalf) => SplitRowAction | null;

export interface ComparisonElementsInput {
    readonly entry: DocumentDiffEntry | null;
    /** Repository-relative path of the document being compared. */
    readonly path: string;
    /** The two versions, or null before the comparison has answered. */
    readonly sides: ComparisonSides | null;
    readonly baseLabel: string;
    readonly headLabel: string;
    /** How to word a row's control. Takes the element's own name. */
    readonly labelFor: (elementName: string) => string;
}

export function useComparisonElements(input: ComparisonElementsInput): SplitRowActionResolver | undefined {
    const { context } = useWorkspace();
    const uiService = useMemo(
        () => (context ? context.services.get<UIService>(Services.UI) : null),
        [context],
    );

    const isUIDocument = input.entry?.documentKind === "ui-document";
    // `sidesOfEntry` answers null for the side a one-sided entry does not have, and `useSideDocument`
    // asks for nothing when it is given null - so a read that could only fail is never made.
    const requested = useMemo(
        () => (isUIDocument && input.entry
            ? sidesOfEntry(input.entry, input.sides ?? undefined)
            : { before: null, after: null }),
        [isUIDocument, input.entry, input.sides],
    );
    const base = useSideDocument<UIDocument>(requested.before, input.path, uiDocumentSpec);
    const head = useSideDocument<UIDocument>(requested.after, input.path, uiDocumentSpec);

    /**
     * The selection as the app holds it, so a row can draw itself as the selected one.
     *
     * Read from the store rather than kept here: the rail is the owner of what is selected, and an
     * element selected on a canvas elsewhere in the window must clear this half's highlight.
     */
    const [selection, setSelection] = useState<ComparisonElementSelection | null>(null);
    useEffect(() => {
        if (!uiService) {
            return undefined;
        }
        const read = (state: { type: string | null; data: unknown }): void => {
            setSelection(
                state.type === COMPARISON_ELEMENT_SELECTION_TYPE
                    ? (state.data as ComparisonElementSelection)
                    : null,
            );
        };
        read(uiService.getStore().getSelection());
        return uiService.getEvents().on("selectionChanged", read);
    }, [uiService]);

    /**
     * A selection into this comparison does not outlive the tab that made it.
     *
     * The rail would otherwise keep drawing an element of a version nobody is looking at any more,
     * with no surface on screen it belongs to. Only this comparison's own selection is cleared, so
     * closing one tab never clears what another one selected.
     */
    useEffect(() => {
        if (!uiService) {
            return undefined;
        }
        return () => {
            const store = uiService.getStore();
            const current = store.getSelection();
            if (
                current.type === COMPARISON_ELEMENT_SELECTION_TYPE
                && current.data.documentPath === input.path
            ) {
                store.setSelection({ type: null, data: null });
            }
        };
    }, [uiService, input.path]);

    const resolve = useCallback<SplitRowActionResolver>(
        (row, half) => {
            const address = comparisonElementAddress(row.change);
            if (!address || !uiService) {
                return null;
            }
            const next = buildComparisonElementSelection({
                documentPath: input.path,
                half,
                versionLabel: half === "base" ? input.baseLabel : input.headLabel,
                counterpartLabel: half === "base" ? input.headLabel : input.baseLabel,
                address,
                document: half === "base" ? base.document : head.document,
                counterpartDocument: half === "base" ? head.document : base.document,
            });
            if (!next) {
                return null;
            }
            return {
                onSelect: () => uiService.getStore().setSelection({
                    type: COMPARISON_ELEMENT_SELECTION_TYPE,
                    data: next,
                }),
                selected: isSameComparisonElement(selection, next),
                label: input.labelFor(next.element.name ?? next.element.type),
            };
        },
        [uiService, input.path, input.baseLabel, input.headLabel, input.labelFor, base.document, head.document, selection],
    );

    return isUIDocument ? resolve : undefined;
}
