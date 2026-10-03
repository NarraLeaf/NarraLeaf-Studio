/**
 * A label in front of every window title, so a person can tell which windows belong to an
 * automated session before touching them.
 *
 * Several instances of Studio, and the games they launch, can share one desktop: one a person is
 * using, others a tool started to run a test, take screenshots or reproduce a bug. Their windows
 * look identical, and a click or a keystroke in the wrong one ruins somebody's run. Setting
 * `NLS_WINDOW_TAG` before launching turns "NarraLeaf Studio" into "[jitter fix] NarraLeaf Studio"
 * in the taskbar, Alt+Tab and any OS-drawn title bar.
 *
 * It is an environment variable rather than a flag because it has to reach every process the
 * instance starts - a Dev Mode game, a preview, a test run - and those inherit the environment
 * without anyone forwarding anything. Unset or blank, nothing is installed and no title changes.
 */

export const WINDOW_TAG_ENV_VAR = "NLS_WINDOW_TAG";

/** Long enough for a short task name; a paragraph would push the real title out of the taskbar. */
const MAX_TAG_LENGTH = 48;

export function readWindowTag(env: Record<string, string | undefined>): string | null {
    const raw = env[WINDOW_TAG_ENV_VAR];
    if (typeof raw !== "string") {
        return null;
    }
    // A title is one line; anything that would break it is folded into a space.
    const tag = raw.replace(/[\s\u0000-\u001f]+/g, " ").trim();
    if (!tag) {
        return null;
    }
    return tag.length > MAX_TAG_LENGTH ? `${tag.slice(0, MAX_TAG_LENGTH - 1)}…` : tag;
}

export function tagTitle(title: string, tag: string): string {
    const prefix = `[${tag}] `;
    return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

/** The slice of a BrowserWindow this needs, so it can be exercised without Electron. */
export interface TaggableWindow {
    setTitle(title: string): void;
    getTitle(): string;
    isDestroyed(): boolean;
    on(event: "page-title-updated", listener: () => void): unknown;
}

export interface WindowCreationSource {
    on(event: "browser-window-created", listener: (event: unknown, window: TaggableWindow) => void): unknown;
}

/**
 * Tag every window the process creates from now on, whoever creates it and however its title is
 * set afterwards.
 *
 * Titles arrive two ways. Main calls `setTitle`, from many places - so that call is wrapped on the
 * window itself rather than at each caller, and a new window type cannot forget it. And Chromium
 * raises the document's `<title>` to the window after `page-title-updated`, unless a listener
 * prevents it; some windows do, and the tag must not decide that for them. So the title is
 * re-tagged a turn later, after the default action has or has not happened, from whatever the
 * window ended up with.
 *
 * `browser-window-created` fires inside the BrowserWindow constructor, so this sees windows made
 * with `new BrowserWindow` and popups made through `window.open` alike, before anyone has set a
 * title on them.
 */
export function installWindowTag(
    source: WindowCreationSource,
    tag: string | null,
    defer: (fn: () => void) => void = fn => setImmediate(fn),
): void {
    if (!tag) {
        return;
    }
    source.on("browser-window-created", (_event, window) => {
        const setTitle = window.setTitle.bind(window);
        window.setTitle = (title: string) => setTitle(tagTitle(title, tag));
        window.on("page-title-updated", () => {
            defer(() => {
                if (!window.isDestroyed()) {
                    window.setTitle(window.getTitle());
                }
            });
        });
        window.setTitle(window.getTitle());
    });
}
