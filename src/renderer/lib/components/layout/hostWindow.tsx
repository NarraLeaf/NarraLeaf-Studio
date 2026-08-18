import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Which window a subtree is actually drawn in.
 *
 * Almost all of Studio is drawn in the window its React tree was created in, and for that subtree
 * this context is never provided: `useHostWindow()` falls back to the module's own `window`, which
 * is what every `document.body` portal and every `document.addEventListener` in this codebase
 * already assumed.
 *
 * A detached editor (`DetachedWindow`) breaks that assumption. It portals part of the workspace's
 * React tree into a second, same-origin browser window - deliberately, because that is what keeps
 * the editor on the one service graph and the one document instance the docked tab had. But the
 * code inside that portal still runs in the workspace's realm, so its bare `document` is the
 * workspace's document: a dropdown portalled to `document.body` opens in the window the author is
 * NOT looking at, and an Escape listener on `document` never hears the key they pressed.
 *
 * So anything that reaches past its own subtree - portals, document/window listeners, focus and
 * geometry reads - asks here which document it is really in. See `DetachedWindow`.
 */
type HostWindow = {
  window: Window;
  /**
   * The detached window's key, which is how the main process addresses it - the buttons this
   * subtree draws for its own title bar have to name the window they mean, because the IPC they
   * send goes out through the opener. See `appDetachedWindowControl`.
   */
  key: string;
};

const HostWindowContext = createContext<HostWindow | null>(null);

export function HostWindowProvider({
  window: hostWindow,
  windowKey,
  children
}: {
  window: Window;
  windowKey: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ window: hostWindow, key: windowKey }), [hostWindow, windowKey]);
  return <HostWindowContext.Provider value={value}>{children}</HostWindowContext.Provider>;
}

/**
 * The window this subtree is drawn in. The renderer's own window unless a detached one provides it.
 *
 * Read through `globalThis` rather than as a bare `window`, because a good part of this codebase's
 * component tests render under vitest's `node` environment, where the identifier does not exist and
 * naming it is a ReferenceError at render time. Those tests never reach for the window itself - the
 * code that does runs in effects, which a server render does not run.
 */
export function useHostWindow(): Window {
  return (
    useContext(HostWindowContext)?.window ?? ((globalThis as { window?: Window }).window as Window)
  );
}

/** The detached window's key, or null in a subtree drawn in the renderer's own window. */
export function useDetachedWindowKey(): string | null {
  return useContext(HostWindowContext)?.key ?? null;
}

/** The document this subtree is drawn in. Portal targets and listener targets belong to it. */
export function useHostDocument(): Document {
  return useHostWindow().document;
}

/**
 * True when the subtree is drawn in a detached window rather than the renderer's own.
 *
 * For the few places where the difference is the point - the pop-out control must not offer to
 * pop out again - not as a licence to branch on it elsewhere. Everything else should ask for the
 * host document and stop caring.
 */
export function useIsDetachedHost(): boolean {
  return useContext(HostWindowContext) !== null;
}
