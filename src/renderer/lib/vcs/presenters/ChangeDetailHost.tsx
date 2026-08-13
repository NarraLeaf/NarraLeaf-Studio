import type { DocumentChange, DocumentDiffEntry } from "@shared/documents/diff";
import { cn } from "@/lib/utils/cn";
import { CHANGE_KIND_GLYPH, CHANGE_KIND_TINT } from "../documentChangeView";
import { splitDocumentPath } from "../changeIndex";
import type { ComparisonSides } from "./comparisonSide";
import { presenterFor } from "./registry";
// Imported for the registration inside them, which is the only thing that puts a presenter in
// front of anyone. Every presenter that is not the fallback belongs on this list.
//
// The order is the tie-break: a presenter imported later wins over an earlier one that also
// claims a document (see `registry.ts`). Nothing here overlaps - three read a content class the
// comparison settled (sound, stills, type) and three read a document kind (the palette, the
// interface, its blueprints) - so the order below is alphabetical rather than meaningful, and
// `registry.test.ts` holds the rule that decides.
import "./AudioChangeDetail";
import "./BitmapChangeDetail";
import "./BrandChangeDetail";
import "./FontChangeDetail";
import "./UIDocumentChangeDetail";
import "./UIGraphsChangeDetail";

/**
 * The detail half of a comparison: which file is being looked at, and exactly one presenter.
 *
 * The identity line is drawn here rather than by each presenter, so a format that takes the body
 * over does not also inherit the job of naming the file - and so two presenters cannot end up
 * spelling the same path two ways.
 *
 * **One presenter, mounted once.** `presenterFor` answers with a single presenter and this renders
 * that one; nothing here loops. The rule matters because the pane it replaced was a stack of every
 * document's changes, and a detail pane that grew a second list would be that stack again with a
 * narrower column in front of it.
 */
export interface ChangeDetailHostProps {
    readonly entry: DocumentDiffEntry;
    /** The selected change, when the selection is finer than the file. */
    readonly change?: DocumentChange;
    /** Which two versions this is a comparison of, for a presenter that reads the file itself. */
    readonly sides?: ComparisonSides;
    readonly className?: string;
}

export function ChangeDetailHost({ entry, change, sides, className }: ChangeDetailHostProps) {
    const presenter = presenterFor(entry);
    const { directory, name } = splitDocumentPath(entry.path);

    return (
        <div className={cn("flex h-full min-h-0 flex-col", className)}>
            <div className="flex shrink-0 items-baseline gap-1.5 overflow-hidden px-3 py-2">
                <span
                    aria-hidden
                    className={cn("w-2 shrink-0 text-center font-mono text-2xs", CHANGE_KIND_TINT[entry.kind])}
                >
                    {CHANGE_KIND_GLYPH[entry.kind]}
                </span>
                <span className="min-w-0 truncate text-xs font-medium text-fg">{name}</span>
                {directory !== null && (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle" data-tip={directory}>
                        {directory}
                    </span>
                )}
            </div>
            <div
                // The one handle a test has on "how many presenters are mounted". Also what tells
                // someone reading the DOM which presenter drew what is in front of them.
                data-change-presenter={presenter.id}
                className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            >
                <presenter.Detail entry={entry} change={change} sides={sides} />
            </div>
        </div>
    );
}
