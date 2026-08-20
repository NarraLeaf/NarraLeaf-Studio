import { useEffect, useMemo, useState } from "react";
import type { UIEditorEnteredState } from "@/lib/workspace/services/services";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useInheritedEnteredState, type EnteredElementState } from "./enteredStateContext";

/**
 * The state this element draws in: the one entered on it, or the one an ancestor entered.
 *
 * Editor canvas only - `enabled` is false in every other host, where a state is never entered and
 * runtime overrides stay authoritative. Reading the element's own entry first is what lets an author
 * enter a state on a container and still step into a nested one further down.
 */
export function useEnteredElementState(elementId: string, enabled: boolean): EnteredElementState | null {
    const inherited = useInheritedEnteredState();
    const stateService = UIEditorStateService.getInstance();
    const [ownVariantId, setOwnVariantId] = useState<string | null | undefined>(() => {
        if (!enabled) {
            return undefined;
        }
        const entered = stateService.getEnteredState();
        return entered?.elementId === elementId ? entered.variantId : undefined;
    });

    useEffect(() => {
        if (!enabled) {
            setOwnVariantId(undefined);
            return undefined;
        }
        const read = () => {
            const entered = stateService.getEnteredState();
            setOwnVariantId(entered?.elementId === elementId ? entered.variantId : undefined);
        };
        read();
        return stateService.on("enteredStateChanged", read);
    }, [elementId, enabled, stateService]);

    // Memoised because this value is broadcast: a fresh object every render would re-render every
    // element under this one on every render of this one.
    const own = useMemo(
        () => (ownVariantId === undefined ? null : { variantId: ownVariantId, own: true }),
        [ownVariantId],
    );

    if (!enabled) {
        return null;
    }
    return own ?? inherited;
}

/**
 * The state entered anywhere in the editor, for panels that sit outside the canvas tree.
 *
 * The canvas resolves per element and inherits down a context; a panel has no ancestors to inherit
 * from, so it reads the one entered state directly and decides for itself whether it is the element
 * it is showing.
 */
export function useEditorEnteredState(): UIEditorEnteredState | null {
    const stateService = UIEditorStateService.getInstance();
    const [entered, setEntered] = useState<UIEditorEnteredState | null>(() => stateService.getEnteredState());
    useEffect(() => {
        setEntered(stateService.getEnteredState());
        return stateService.on("enteredStateChanged", next => setEntered(next));
    }, [stateService]);
    return entered;
}
