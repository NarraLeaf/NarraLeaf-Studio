import { createContext, useContext } from "react";

/**
 * Which document the surrounding inspector writes, and whether somebody else is inside it.
 *
 * **Why this exists at all.** `useFreezeGuard()` with no scope answers "frozen" for any freeze at
 * all, and that default must never soften: the workspace has surfaces in the dozens and only a
 * handful of them can name the file they edit, so a default that answered "writable" would unlock
 * every one of the rest the day the first partial freeze shipped. The properties panel is one of the
 * ones that *can* name it - but not as a whole, because it hosts a different schema per selection,
 * and each of those writes a different document.
 *
 * So the branch that knows says so, and every field under it inherits the answer. A branch that says
 * nothing keeps the conservative default exactly as it was, which is what every other inspector in
 * the panel still gets.
 *
 * **`heldBy` is the live-session half, and it is not a freeze.** A character record somebody else has
 * open is writable as far as the write boundary is concerned - the document is one the session
 * carries - and the host would refuse the operation anyway. Letting the author type a description and
 * telling them afterwards is precisely the injury a claim exists to prevent, so the fields stand down
 * while the mark says who has it.
 *
 * ⚠ **Read-only, never hidden.** Reading a record somebody else is editing is the ordinary thing to
 * want while they are editing it.
 */
export type InspectorWrites = {
    /**
     * The project-relative path this inspector's fields write, or undefined when it cannot say.
     *
     * A list where the inspector writes more than one file and needs all of them - the asset
     * library, whose rows are filed in a shard per type and which a session carries whole or not at
     * all. `useFreezeGuard` blocks unless every path is allowed.
     */
    scope?: string | readonly string[];
    /** The account editing this subject in a live session, or undefined when nobody else is. */
    heldBy?: string;
};

const InspectorWritesContext = createContext<InspectorWrites>({});

export const InspectorWritesProvider = InspectorWritesContext.Provider;

/** What the surrounding inspector said about what it writes. Empty outside one. */
export function useInspectorWrites(): InspectorWrites {
    return useContext(InspectorWritesContext);
}
