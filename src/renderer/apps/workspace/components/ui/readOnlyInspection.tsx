import { createContext, useContext, type ReactNode } from "react";

/**
 * A subtree that is looking at something rather than editing it.
 *
 * The workspace already has a read-only mode - the write freeze - and every field of the property
 * framework, the blueprint canvas and the story row clamps consult it through
 * `useFreezeGuard`. What it cannot do is apply to PART of a window: the freeze is a latch on the
 * project, so a panel drawing a past version beside panels editing the present one has nothing to
 * ask. This is that missing scope, and it is read by the same guard, so everything already wired to
 * the freeze is correct inside one of these without being told about it.
 *
 * **It is a different fact and it says so.** The freeze's sentence is that the project is frozen,
 * which is false here: nothing is frozen, the author is reading a version that has already happened.
 * The guard picks the reason from whichever of the two applies (see `freezeGuard.ts`).
 *
 * **Affordance, not enforcement.** A control greyed out by this is still a control in a React tree,
 * and a field whose renderer ignores `readOnly` would still be reachable were it not for the
 * fieldset clamp - and even that does not travel through a portal, so a popover opened from inside
 * one escapes it. Whatever the subtree writes THROUGH has to refuse as well; for the comparison
 * inspector that is `createReadOnlyDocumentService`, whose every mutator throws.
 */
const ReadOnlyInspectionContext = createContext(false);

/** Mark everything inside as inspection: no control in it may offer to write. */
export function ReadOnlyInspection({ children }: { children: ReactNode }) {
    return <ReadOnlyInspectionContext.Provider value={true}>{children}</ReadOnlyInspectionContext.Provider>;
}

/**
 * Whether this point in the tree is inside an inspection.
 *
 * For {@link useFreezeGuard} and for the tests that mount a subtree without one. Anything else
 * should ask the guard, which answers the question a control actually has.
 */
export function useReadOnlyInspection(): boolean {
    return useContext(ReadOnlyInspectionContext);
}
