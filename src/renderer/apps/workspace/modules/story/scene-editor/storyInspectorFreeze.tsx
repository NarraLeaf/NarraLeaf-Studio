import type { ReactNode } from "react";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { storyDocumentFreezeScope } from "./storySceneReadOnly";

/**
 * The story action inspector's two read-only clamps, and why there have to be two of them.
 *
 * The inspector is two and a half thousand lines of per-action editors - forty-odd `Select`s, the
 * numeric grids, the expression and condition entries - written by whoever added each action kind,
 * and it reaches the properties panel WITHOUT going through `FieldRenderer`, so it inherited none of
 * that framework's read-only work. Measured on a frozen project before the clamp existed: every
 * field accepted input and every change was discarded on thaw.
 *
 * The clamp is a `disabled` `<fieldset>` rather than a `freeze.writes()` per control precisely
 * because of that headcount: per HTML, every form control beneath a disabled fieldset is disabled
 * whether or not it has ever heard of the freeze, including the ones in an action editor written
 * after this line. `display: contents` keeps it out of the layout.
 *
 * **The cost of that reach is that HTML gives a disabled fieldset no way to exempt a descendant** -
 * the one escape in the spec is its first `<legend>` - so a single clamp can only ever answer one
 * question for the whole body. That is what the split below is for: almost every field here writes
 * the story document and nothing else, so the outer clamp asks about that document
 * ({@link StoryDocumentClamp}) and stays open during a live session; the handful of subtrees that
 * reach past it get {@link BeyondStoryDocumentClamp} nested inside, which keeps the conservative
 * answer.
 *
 * Two things are outside both clamps because they are not form controls: `Disclosure` is a
 * `<details>`/`<summary>`, so sections still open, and the blueprint entry card steps out through
 * `InspectOnlyButton` (see `StoryActionBlueprintPreviewCard`) so a graph can still be read.
 */

/**
 * Everything whose only write is `storyId`'s own document.
 *
 * Scoped, so the one freeze that is partial - a live session, which leaves a single story document
 * writable - leaves the inspector for that document working. Editing a row and editing the same row
 * through the inspector are the same write to the same file, and a session that allowed the first
 * while greying out the second would be telling the author two different things about one document.
 *
 * The scope is derived from the document spec by {@link storyDocumentFreezeScope} rather than spelled
 * here, and the decision is `freezeAllowsWrite`'s - the very function the write boundary calls - so a
 * field this leaves live is a field whose write the boundary accepts.
 */
export function StoryDocumentClamp(props: { storyId: string; children: ReactNode }) {
    const freeze = useFreezeGuard(storyDocumentFreezeScope(props.storyId));
    if (!freeze.frozen) {
        return props.children;
    }
    return (
        <fieldset disabled aria-readonly style={{ display: "contents" }}>
            {props.children}
        </fieldset>
    );
}

/**
 * A subtree that writes something the story document does not hold.
 *
 * Nested inside {@link StoryDocumentClamp} at each place the inspector offers one, and deliberately
 * UNSCOPED: it names no document, so it is frozen by any freeze at all - which is the answer for a
 * write no partial freeze covers. The motion picker is the standing example: binding a motion writes
 * the block's payload, but the same panel's `New` and its preset gallery mint a story animation
 * asset of their own, and a live session would refuse that file. Offering it anyway would be an edit
 * that half lands - the block points at a motion whose asset was never written.
 *
 * Nesting is what makes this correct rather than merely tidy: a fieldset cannot exempt a descendant,
 * so the only way to be stricter than the clamp around you is to add one of your own inside it.
 */
export function BeyondStoryDocumentClamp(props: { children: ReactNode }) {
    const freeze = useFreezeGuard();
    if (!freeze.frozen) {
        return props.children;
    }
    return (
        <fieldset disabled aria-readonly style={{ display: "contents" }}>
            {props.children}
        </fieldset>
    );
}
