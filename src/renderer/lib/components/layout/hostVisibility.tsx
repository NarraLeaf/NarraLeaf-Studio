import React, { createContext, useContext, useEffect, useRef } from "react";

/**
 * Whether the surface this subtree is drawn into is the one on screen.
 *
 * Editor tabs and sidebar panels are kept alive when the author moves off them: they stay mounted
 * behind `display: none`, which is what preserves a scroll position, a caret, and an edit in
 * progress across a tab switch. Anything the subtree portalled to the document body is NOT inside
 * that hidden box, though, so a popup opened from a row goes on hanging in the middle of the window
 * over whatever the author switched to - still keyboard-navigable, still owning Escape, and with no
 * visible connection to anything.
 *
 * A portalled layer therefore has to be told, and this is what tells it. The default is `true`, so a
 * component used anywhere else - a dialog, another window - behaves exactly as it did before.
 */
const HostVisibleContext = createContext(true);

/**
 * Marks a subtree as on screen or put away; see {@link useDismissWhenHidden}.
 *
 * Nests by AND, because the hiding does: a panel that is the selected one in its stack is still not
 * on screen while the sidebar holding that stack is collapsed, and the inner mark saying `visible`
 * must not be able to talk over the outer one saying otherwise.
 */
export function HostVisibility({ visible, children }: { visible: boolean; children: React.ReactNode }) {
    const inherited = useHostVisible();
    return <HostVisibleContext.Provider value={inherited && visible}>{children}</HostVisibleContext.Provider>;
}

/** Whether the editor tab or panel holding this subtree is the one on screen. */
export function useHostVisible(): boolean {
    return useContext(HostVisibleContext);
}

/**
 * Put a transient layer away when the tab or panel it belongs to stops being the one on screen.
 *
 * `open` keeps the dismissal from firing at every host that was never showing anything; the callback
 * is read through a box so a closure rebuilt on each render does not re-run it.
 */
export function useDismissWhenHidden(dismiss: () => void, open = true): void {
    const visible = useHostVisible();
    const latest = useRef(dismiss);
    useEffect(() => {
        latest.current = dismiss;
    });
    useEffect(() => {
        if (visible || !open) return;
        latest.current();
    }, [visible, open]);
}
