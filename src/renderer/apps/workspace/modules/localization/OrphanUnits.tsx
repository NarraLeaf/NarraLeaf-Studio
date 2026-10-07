/**
 * Orphans: the translations and the voice takes of a language whose line is no longer in the game -
 * deleted, cut and pasted elsewhere, or disabled. They do nothing in a playthrough, and they are
 * still carried in the language and packed into a build.
 *
 * The translation table and the voice table each list their language's orphans in place of a story
 * (the project check's `localization/orphan` and `voice/orphan` findings open them there), and both
 * read them the one way the rules count them (`orphanTranslationUnitIds` / `orphanVoiceUnitIds`), so
 * the number on a finding is the number of rows it opens.
 *
 * Comments in English per project convention.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryDocument } from "@shared/types/story";
import { indexStoryTextLines, liveTextIds, type StoryTextLine } from "@/lib/lint/rules/text/textSegments";

/** The value a table's source picker holds while it lists the language's orphans instead of a story. */
export const ORPHANS_SOURCE_VALUE = "__orphans__";

/**
 * Every story's lines by text id, and which of them are in the game.
 *
 * `unreadable` when a story could not be read: its lines would be missing from the live set, and every
 * translation of them would be listed as an orphan - and offered for deletion. Nothing is listed
 * rather than that.
 */
export type StoryTextLineIndex =
    | { kind: "ready"; lines: ReadonlyMap<string, StoryTextLine>; live: ReadonlySet<string> }
    | { kind: "unreadable" }
    | { kind: "loading" };

/**
 * The lines of every story, kept current as stories change.
 *
 * Every story is read: an orphan is defined against the whole game, and a table showing one story
 * cannot tell a line that moved to another story from one that is gone.
 */
export function useStoryTextLineIndex(storyService: StoryService | null): StoryTextLineIndex {
    const [index, setIndex] = useState<StoryTextLineIndex>({ kind: "loading" });
    useEffect(() => {
        if (!storyService) {
            setIndex({ kind: "loading" });
            return;
        }
        let run = 0;
        const read = async () => {
            const mine = ++run;
            const stories: { name: string; document: StoryDocument }[] = [];
            let lines: ReturnType<typeof indexStoryTextLines>;
            try {
                for (const entry of storyService.listStories()) {
                    const document: StoryDocument | undefined = await storyService.loadStory(entry.id);
                    // A story that loads as nothing is as unreadable as one that throws: listing
                    // without it would offer that story's lines up as orphans to be deleted.
                    if (!document) {
                        throw new Error(`Story ${entry.id} could not be read`);
                    }
                    stories.push({ name: entry.name, document });
                }
                lines = indexStoryTextLines(stories);
            } catch {
                if (mine === run) {
                    setIndex({ kind: "unreadable" });
                }
                return;
            }
            if (mine === run) {
                setIndex({ kind: "ready", lines, live: liveTextIds(lines) });
            }
        };
        void read();
        const offLibrary = storyService.onLibraryChanged(() => void read());
        const offDocument = storyService.onDocumentChanged(() => void read());
        return () => {
            run += 1;
            offLibrary();
            offDocument();
        };
    }, [storyService]);
    return index;
}

/** One orphan as the list draws it. */
export type OrphanUnitRow = {
    unitId: string;
    /** The line it belonged to, when that line is still in a story (under a disabled row). */
    line?: StoryTextLine;
    /** What the unit holds: the translation, or the take. */
    content: ReactNode;
};

export type OrphanUnitListStrings = {
    summary: string;
    disabledLine: string;
    deletedLine: string;
    /** The per-row action, and its tooltip. */
    removeOne: string;
    removeAll: string;
};

/**
 * The list of a language's orphans with a way to delete them, one at a time or all at once.
 *
 * Every control is drawn, not revealed on hover: this view exists so the orphans can be found and
 * cleared, and an action that appears only under the pointer is one an author has to know about first.
 */
export function OrphanUnitList({
    rows,
    strings,
    frozen,
    frozenReason,
    onRemove,
}: {
    rows: readonly OrphanUnitRow[];
    strings: OrphanUnitListStrings;
    /** The language's document cannot be written right now; the controls are drawn, greyed. */
    frozen: boolean;
    frozenReason?: string;
    onRemove: (unitIds: string[]) => void;
}) {
    return (
        <div className="flex min-h-0 flex-col" data-orphan-list="">
            <div className="flex items-center gap-3 border-b border-edge bg-surface-sunken px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{strings.summary}</span>
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={frozen}
                    data-tip={frozen ? frozenReason : undefined}
                    onClick={() => onRemove(rows.map(row => row.unitId))}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    {strings.removeAll}
                </Button>
            </div>
            {rows.map(row => (
                <div
                    key={row.unitId}
                    data-orphan-unit=""
                    className="flex items-start gap-4 border-b border-edge-subtle px-4 py-2.5"
                >
                    <div className="flex w-1/2 min-w-0 flex-col gap-1">
                        <span className="truncate text-2xs text-fg-subtle">
                            {row.line
                                ? [strings.disabledLine, row.line.storyName, row.line.sceneName].filter(Boolean).join(" · ")
                                : strings.deletedLine}
                        </span>
                        {row.line ? (
                            <span className="whitespace-pre-wrap break-words text-xs text-fg-muted">{row.line.text}</span>
                        ) : null}
                    </div>
                    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-fg">{row.content}</div>
                    <ToolbarButton
                        size="xs"
                        className="shrink-0 text-fg-subtle hover:bg-fill hover:text-fg"
                        aria-label={strings.removeOne}
                        data-tip={frozen ? frozenReason : strings.removeOne}
                        disabled={frozen}
                        onClick={() => onRemove([row.unitId])}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </ToolbarButton>
                </div>
            ))}
        </div>
    );
}
