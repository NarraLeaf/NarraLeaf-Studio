/**
 * The reconciler's contract, standing in for the reconciler.
 *
 * **This file is a placeholder. Replace it wholesale when the implementation lands.** The reconciler
 * is being written on its own branch; what the script view needs from it here is the *shape*, so that
 * the two halves are held together by the compiler rather than by a merge. Everything below the type
 * declarations is a refusal, deliberately: a stand-in that quietly rewrote an author's scene would be
 * far worse than one that cannot run at all.
 *
 * ## What the reconciler is for
 *
 * Re-parsing a whole scene produces a correct block tree and the wrong document. Every line the
 * author did not touch comes back with a fresh id and a re-normalised payload, so a one-word edit
 * rewrites the scene end to end: references into it break, scene snapshots stop resolving, and the
 * diff a collaborator reviews is the entire file. The reconciler's guarantee is the opposite one -
 * **a line the author did not edit keeps its block id and its payload byte for byte** - and
 * {@link NarralangReconcileResult.touchedBlockIds} is how a caller learns that nothing moved without
 * having to diff the scene for itself.
 */

import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";

import type { NarralangDialect } from "./narralangDialect";
import type { NarralangDiagnostic, NarralangParseLookups } from "./narralangParse";
import type { NarralangLookups } from "./narralangPrinter";

/**
 * A line the reconciler could not read.
 *
 * The parser's own diagnostic, renamed at this boundary: a caller of the reconciler holds a text
 * buffer and an editor, and has no reason to know the parser exists.
 */
export type NarralangParseDiagnostic = NarralangDiagnostic;

export type NarralangReconcileResult =
    | {
        readonly ok: true;
        readonly rootBlockIds: StoryBlockId[];
        readonly blocks: Record<StoryBlockId, StoryBlock>;
        /**
         * Every block the text actually changed - added, removed, re-parented, reordered or
         * rewritten. Empty means the scene is unchanged and there is nothing to commit.
         */
        /**
         * Every block whose *content* the text changed - added, or rewritten. **Not** a block that
         * only moved or changed parent: re-indenting a passage leaves every payload byte-identical
         * and this array empty. A caller deciding whether to commit therefore has to compare the
         * tree as well; see `narralangSceneMoved`.
         */
        readonly touchedBlockIds: StoryBlockId[];
        /**
         * The scene name off the script header, or null when the text carried none.
         *
         * Reported, never applied: renaming a scene is the outline's job, and a rename that happened
         * silently as a side effect of typing would be a rename with no undo the author could find.
         */
        readonly sceneName: string | null;
    }
    | { readonly ok: false; readonly diagnostics: NarralangParseDiagnostic[] };

export type NarralangReconcileInput = {
    scene: StoryScene;
    nextText: string;
    lookups: NarralangLookups;
    parseLookups: NarralangParseLookups;
    dialect?: NarralangDialect;
    /**
     * What `visited(…)`, `picked(…)` and a blueprint call resolve against.
     *
     * Optional in the type and mandatory in practice for any caller editing a real project. The
     * three tables it carries are not variables - variables arrive through `parseLookups` and
     * through the declarations in the text itself - and nothing else can supply them. Leaving it out
     * makes every such name unresolvable, which is a diagnostic, and **one diagnostic refuses the
     * whole buffer**: an author who opens a scene containing a single `visited(…)` would find that
     * nothing they type can be saved, including the lines they never touched, with nothing on screen
     * to say why.
     */
    expressionScope?: Partial<StoryExpressionScope>;
};

export function reconcileNarralangScene(_input: NarralangReconcileInput): NarralangReconcileResult {
    // Not "return no changes" and not "re-parse everything": either would be a plausible-looking
    // answer, and the first silently discards an edit while the second silently rewrites a document.
    // A placeholder that cannot be mistaken for the thing it stands in for has to refuse out loud.
    throw new Error("reconcileNarralangScene: the reconciler has not landed on this branch yet");
}
