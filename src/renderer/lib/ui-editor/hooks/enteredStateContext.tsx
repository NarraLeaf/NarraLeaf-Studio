import { createContext, useContext, type ReactNode } from "react";

/** The state an element is being shown in. `variantId` is null for the state it rests in. */
export type EnteredElementState = { variantId: string | null };

const EnteredStateContext = createContext<EnteredElementState | null>(null);

/**
 * Carries the state an element entered down to everything drawn inside it.
 *
 * A state is entered on one element but is about the whole subtree - a switch turns on, and both of
 * its parts have to move - and the tree is drawn by a deep recursion with a long positional
 * signature, so this rides a context rather than another parameter. Each node passes on its own
 * entered state if it has one and the inherited one otherwise, which is why a descendant carrying no
 * variant of that id still resolves correctly: it reads the id, finds nothing, and rests.
 *
 * Rendered unconditionally, value and all: wrapping only while a state is entered would change the
 * element type of the subtree's root as the author enters one, and React would remount the very
 * elements whose movement is the thing being authored.
 */
export function EnteredStateProvider({
    value,
    children,
}: {
    value: EnteredElementState | null;
    children: ReactNode;
}) {
    return <EnteredStateContext.Provider value={value}>{children}</EnteredStateContext.Provider>;
}

/** The state an ancestor entered, or null when everything above this element is resting. */
export function useInheritedEnteredState(): EnteredElementState | null {
    return useContext(EnteredStateContext);
}

/**
 * The variant an element draws with.
 *
 * An entered state wins over every runtime override, and wins even when it resolves to null: while an
 * author is looking at one state, nothing may quietly draw another. Outside the editor nothing is
 * ever entered, so the runtime candidates - a list row's variant, a blueprint's, a switch part's -
 * are read in the order they are passed, first non-empty one taking it.
 */
export function variantOverrideIdFor(
    entered: EnteredElementState | null,
    ...runtimeCandidates: (string | null | undefined)[]
): string | null {
    if (entered) {
        return entered.variantId;
    }
    for (const candidate of runtimeCandidates) {
        if (typeof candidate === "string" && candidate) {
            return candidate;
        }
    }
    return null;
}
