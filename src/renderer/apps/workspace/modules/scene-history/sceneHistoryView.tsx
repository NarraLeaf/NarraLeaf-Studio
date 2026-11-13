/**
 * Shared presentation for scene history: how a snapshot's time reads, how a row reads as text, and
 * how a before/after pair is drawn. Comments in English per convention.
 */

import type { StoryBlock, StoryScene, StorySceneId } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import { characterRowLookup } from "../story/scene-editor/storySceneBlockUtils";
import { diffText, type TextDiffPart } from "@/lib/workspace/services/story/sceneHistory/sceneHistoryModel";

export function formatHistoryTime(at: number, locale: string): string {
    const date = new Date(at);
    const sameDay = new Date().toDateString() === date.toDateString();
    return sameDay
        ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        : date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A row as one line of text: the editor's own line when the caller has one, else its description. */
export function historyRowText(
    block: StoryBlock,
    characters: Character[],
    scene: StoryScene | undefined,
    scenes: Record<StorySceneId, StoryScene> | undefined,
    readLine?: (block: StoryBlock) => string | null,
): string {
    const line = readLine?.(block) ?? null;
    if (line !== null) return line;
    return describeStoryBlock(block, { character: characterRowLookup(characters), scene, scenes });
}

/** Before → after, with removed text struck through in the danger tone and added text in the success tone. */
export function TextDiffView({ before, after, className }: { before: string; after: string; className?: string }) {
    const parts: TextDiffPart[] = diffText(before, after);
    return (
        <span className={["whitespace-pre-wrap break-words", className].filter(Boolean).join(" ")}>
            {parts.map((part, index) => (
                <span
                    key={index}
                    className={part.kind === "removed"
                        ? "rounded-sm bg-danger/15 text-danger line-through"
                        : part.kind === "added"
                            ? "rounded-sm bg-success/15 text-success"
                            : undefined}
                >
                    {part.text}
                </span>
            ))}
        </span>
    );
}
