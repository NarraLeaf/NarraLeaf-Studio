import { useEffect, useMemo, useState } from "react";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { storyDocumentSpec } from "@shared/documents/specs/story";
import type { StoryDocument } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import type { MergeSidesDescriber } from "@/lib/vcs/ConflictDetail";
import type { MergeDocumentEntry } from "@/lib/vcs/mergeDecisionView";
import { parseSideDocument } from "@/lib/vcs/presenters/sideDocument";
import { describeStoryMergeSides } from "@/lib/vcs/storyMergeSides";
import { narralangLookups } from "../story/narralang/narralangLookups";
import { useWorkspace } from "../../context";

/** What a merge keeps beside a conflicted file as the author's own side of it (docs §4.23). */
const MINE_COPY = "~mine";

/**
 * The story editor's reading of the selected file's rows, when that file is a story.
 *
 * Reads the author's copy of the story the merge left beside it - once per selected story - and names
 * everything in a row the way the story tools name it (`narralangLookups`: the cast, the asset library
 * and its sets, motions, appearances, variables, build variants and pages). Answers undefined for any
 * other file, for a story the merge could not compose, and until the copy has been read; the rows are
 * then drawn field by field as they always were, so a story whose copy cannot be read still offers
 * every decision it has.
 */
export function useStoryMergeSides(
    path: string | null,
    entry: MergeDocumentEntry | undefined,
): MergeSidesDescriber | undefined {
    const { context } = useWorkspace();
    const isStory = entry?.status === "ready"
        && entry.document.documentKind === "story"
        && entry.document.blocked === undefined;
    const [story, setStory] = useState<{ readonly path: string; readonly document: StoryDocument } | null>(null);

    const service = useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    useEffect(() => {
        if (!isStory || path === null || !service) {
            setStory(null);
            return;
        }
        let cancelled = false;
        void service.readWorkingFile(`${path}${MINE_COPY}`)
            .then(bytes => {
                if (cancelled) return;
                // Parsed under the story's own path: the spec takes the story's id from where the
                // file lives, and the copy lives beside it under another name.
                setStory(bytes ? { path, document: parseSideDocument(storyDocumentSpec, path, bytes) } : null);
            })
            .catch(() => {
                if (!cancelled) setStory(null);
            });
        return () => {
            cancelled = true;
        };
    }, [isStory, path, service]);

    return useMemo(() => {
        if (!isStory || !story || story.path !== path || !context) {
            return undefined;
        }
        let lookups: StoryRowLookups;
        try {
            lookups = narralangLookups(context.services, story.document);
        } catch {
            // A workspace missing one of the tables still draws the line; a name it cannot resolve
            // reads as the projection's own word for "unknown", never as an id.
            lookups = { character: () => null };
        }
        const document = story.document;
        return (decision: DocumentMergeDecision) => describeStoryMergeSides(decision, document, lookups);
    }, [isStory, story, path, context]);
}
