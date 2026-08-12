import { BrowserWindow, screen } from "electron";
import { CONFIRM_QUIT_DEFAULT, CONFIRM_QUIT_KEY } from "@shared/constants/quit";
import type { BaseApp } from "../baseApp";
import { getMainTranslator } from "../i18n";
import { decideHoldAction } from "./holdToQuitDecision";

/**
 * How long ⌘Q must stay down before the quit goes through.
 *
 * Long enough that no keystroke meant for something else lasts it out, short enough that someone
 * who meant to quit does not wonder whether the key registered. The overlay's bar is driven by the
 * same number, so it always finishes exactly as the quit starts.
 */
const HOLD_DURATION_MS = 1000;

const OVERLAY_WIDTH = 320;
const OVERLAY_HEIGHT = 104;

/**
 * The overlay's document, loaded once from a `data:` URL and then re-driven per hold.
 *
 * Deliberately not a Studio window: it has no preload, no IPC, no permissions entry and no theme
 * of its own. It is drawn over whatever the author was looking at - another app's window included -
 * so it takes the fixed dark treatment every operating-system HUD uses rather than following the
 * interface theme, which would make it invisible against half the things it can appear over.
 *
 * Both strings and the bar are set at show time (see `runOverlayScript`), so a language changed
 * mid-session needs no reload.
 */
const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
    html, body {
        margin: 0;
        height: 100%;
        background: transparent;
        overflow: hidden;
        cursor: default;
        user-select: none;
        -webkit-user-select: none;
    }
    body {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    }
    #panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        box-sizing: border-box;
        width: 100%;
        padding: 22px 24px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.78);
        color: #ffffff;
    }
    #label {
        font-size: 13px;
        line-height: 1;
        white-space: nowrap;
    }
    #track {
        width: 100%;
        height: 3px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.24);
        overflow: hidden;
    }
    #bar {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: #ffffff;
    }
</style>
</head>
<body>
    <div id="panel">
        <div id="label"></div>
        <div id="track"><div id="bar"></div></div>
    </div>
</body>
</html>`;

/**
 * Turns ⌘Q from a keystroke into a gesture that has to be held, on macOS, when the author asked
 * for it (`app.confirmQuit`).
 *
 * ## Why the main process, and why this listener
 *
 * ⌘Q is not a shortcut Studio registers: it is the App menu's key equivalent (`role: "quit"` in
 * {@link menuManager.ts}), which macOS acts on before any window sees it. `before-input-event` is
 * the one hook that runs earlier still - Electron documents it as preventing "the page keydown/keyup
 * events *and the menu shortcuts*" - so swallowing the keystroke there is what makes the hold
 * possible at all. Nothing about the menu item changes; with the preference off, this class does
 * not call `preventDefault` and ⌘Q quits on the keystroke exactly as it always did.
 *
 * ## What ends a hold
 *
 * Releasing ⌘ ends it, and so does pressing anything else, or Studio ceasing to be the active app.
 * Releasing only Q while ⌘ stays down does *not*, and cannot: macOS does not deliver key-up events
 * for ordinary keys while Command is held, which is a property of the platform's event stream
 * rather than of Electron. The `keyUp` branch below still handles Q for the layouts and platforms
 * where it does arrive. Chrome, whose behaviour this mirrors, has the same limit for the same
 * reason.
 *
 * The listener is attached to every `webContents` rather than to a window list, because a hold has
 * to survive whichever surface happens to be focused - a workspace, the launcher, a detached
 * editor, DevTools - and windows come and go beneath it.
 *
 * ## Where it does not apply
 *
 * The keystroke has to reach a Studio surface for any of this to happen. ⌘Q pressed while Studio is
 * active with no window open at all - it stays resident in the Dock, see `handleLastWindowClosed` -
 * goes to the App menu and quits at once, and so does Quit from the Dock's own menu. Both are
 * deliberate: there is no author-facing surface to lose in either case, and no key-up will ever be
 * reported to end a hold that could be started.
 */
export class HoldToQuitManager {
    private overlay: BrowserWindow | null = null;
    private overlayReady: Promise<BrowserWindow> | null = null;
    private timer: NodeJS.Timeout | null = null;
    /**
     * Which hold the overlay work in flight belongs to.
     *
     * Building the overlay is asynchronous and a hold is a keystroke long, so the load can outlive
     * the hold that asked for it. Everything that resumes after an `await` compares this first;
     * without it, a tap of ⌘Q leaves an overlay on screen with nothing behind it.
     */
    private holdToken = 0;
    private holding = false;

    constructor(private readonly app: BaseApp) { }

    public initialize(): void {
        // macOS only. Windows and Linux quit through Alt+F4 and the close box, neither of which is
        // adjacent to anything an author aims for, and both of which already pass through the
        // window close guards. See the settings row, which is disabled rather than hidden there.
        if (process.platform !== "darwin") {
            return;
        }

        this.app.electronApp.on("web-contents-created", (_event, contents) => {
            contents.on("before-input-event", (event, input) => {
                this.handleInput(event, input);
            });
        });

        // Cmd+Tab, a click into another app, the screen locking: the keys are still down as far as
        // Studio can tell, and nothing more will ever arrive to say otherwise. Ending the hold is
        // the only answer that cannot quit an app the author has walked away from.
        //
        // The overlay is excluded because it is a window of ours: were it ever to take key status
        // it would blur the window the author is actually in, and this would cancel every hold.
        this.app.electronApp.on("browser-window-blur", (_event, window) => {
            if (window !== this.overlay) {
                this.cancel();
            }
        });
    }

    /**
     * Whether ⌘Q should be held rather than acted on. Read per keystroke: the preference is a
     * switch in another window, and the answer has to be the current one, not the launch one.
     */
    private isArmed(): boolean {
        const stored = this.app.globalState.get(CONFIRM_QUIT_KEY);
        return typeof stored === "boolean" ? stored : CONFIRM_QUIT_DEFAULT;
    }

    private handleInput(event: Electron.Event, input: Electron.Input): void {
        // `isArmed()` is only consulted for the chord itself, so a hold already running is still
        // cancellable by the ordinary rules if the preference is switched off mid-keystroke.
        const decision = decideHoldAction(input, { armed: this.isArmed(), holding: this.holding });
        switch (decision) {
            case "begin":
                // preventDefault is what keeps the App menu from acting on the keystroke; without
                // it the quit happens instantly and the hold is decoration.
                event.preventDefault();
                this.begin();
                return;
            case "swallow":
                // Auto-repeat. Letting one through would quit halfway into a hold the author could
                // still have abandoned.
                event.preventDefault();
                return;
            case "cancel":
                this.cancel();
                return;
            case "ignore":
                return;
        }
    }

    private begin(): void {
        this.holding = true;
        const token = ++this.holdToken;

        this.timer = setTimeout(() => {
            this.timer = null;
            this.holding = false;
            // Retires the token as `cancel` does: a slow first load still in flight must not put an
            // overlay back on screen behind the quit that has just started.
            this.holdToken++;
            this.hideOverlay();
            this.app.logger.info("[Quit] Hold completed; quitting.");
            this.app.quit();
        }, HOLD_DURATION_MS);

        void this.showOverlay(token).catch((error) => {
            // A hold with no overlay is a quit that gives no warning, which is worse than one that
            // does not happen: there is nothing on screen to explain why the key did nothing.
            this.app.logger.warn("[Quit] Failed to show the hold overlay; cancelling the hold.", error);
            this.cancel();
        });
    }

    private cancel(): void {
        if (!this.holding) {
            return;
        }
        this.holding = false;
        this.holdToken++;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.hideOverlay();
    }

    private hideOverlay(): void {
        if (this.overlay && !this.overlay.isDestroyed()) {
            this.overlay.hide();
        }
    }

    private async showOverlay(token: number): Promise<void> {
        const overlay = await this.ensureOverlay();
        if (token !== this.holdToken) {
            return;
        }

        overlay.setBounds(this.overlayBounds());
        const { t } = getMainTranslator(this.app);
        await overlay.webContents.executeJavaScript(this.overlayScript(t("menu.app.holdToQuit")));
        if (token !== this.holdToken) {
            return;
        }

        // showInactive, not show: the window the author is typing in has to keep key status, or the
        // key-up that ends the hold is delivered somewhere this class cannot see it.
        overlay.showInactive();
    }

    /**
     * Sets the overlay's text and restarts its bar from zero.
     *
     * Restarting a CSS transition needs the intermediate value to be laid out before the target is
     * set, which is what reading `offsetWidth` in the middle forces; without it the browser
     * collapses both assignments into one and the bar simply appears full.
     */
    private overlayScript(label: string): string {
        return `(() => {
            document.getElementById("label").textContent = ${JSON.stringify(label)};
            const bar = document.getElementById("bar");
            bar.style.transition = "none";
            bar.style.width = "0%";
            void bar.offsetWidth;
            bar.style.transition = "width ${HOLD_DURATION_MS}ms linear";
            bar.style.width = "100%";
        })()`;
    }

    /**
     * The overlay's place on screen: centred on whichever display the author is working on, which
     * is the display of the focused window and only otherwise the primary one.
     */
    private overlayBounds(): Electron.Rectangle {
        const focused = BrowserWindow.getFocusedWindow();
        const display = focused && !focused.isDestroyed()
            ? screen.getDisplayMatching(focused.getBounds())
            : screen.getPrimaryDisplay();
        const area = display.workArea;
        return {
            x: Math.round(area.x + (area.width - OVERLAY_WIDTH) / 2),
            y: Math.round(area.y + (area.height - OVERLAY_HEIGHT) / 2),
            width: OVERLAY_WIDTH,
            height: OVERLAY_HEIGHT,
        };
    }

    /**
     * The overlay window, built on the first hold and kept for the rest of the session.
     *
     * Built late because most sessions never hold ⌘Q at all, and kept because building it is the
     * one slow part of the gesture: the first hold pays for a window and a document load inside its
     * first second, every later one is instant.
     *
     * It is a real `BrowserWindow`, so from the first hold onwards Electron's `window-all-closed`
     * stops firing. Nothing turns on that event: residency is driven by `WindowManager`'s own
     * "window-closed", whose registry this window is not in, and the listener that would otherwise
     * matter (the one in `baseApp` that stops Electron quitting on the last close) only does
     * anything on the platforms this class does not run on.
     */
    private ensureOverlay(): Promise<BrowserWindow> {
        if (this.overlay && !this.overlay.isDestroyed()) {
            return Promise.resolve(this.overlay);
        }
        if (this.overlayReady) {
            return this.overlayReady;
        }

        const overlay = new BrowserWindow({
            ...this.overlayBounds(),
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: "#00000000",
            hasShadow: false,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            // Non-activating, so the author's window keeps key status while this is up. Everything
            // this class knows about the keyboard arrives through that window.
            focusable: false,
            acceptFirstMouse: false,
            // NSPanel rather than NSWindow: it floats without joining the window cycle, which is
            // also what stops it appearing in Window menus and mission control.
            type: "panel",
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });

        overlay.setIgnoreMouseEvents(true);
        // "screen-saver" and `visibleOnFullScreen` together are what put it over a Studio window in
        // full screen, which is exactly where an author is most likely to hit ⌘Q by accident.
        overlay.setAlwaysOnTop(true, "screen-saver");
        overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        overlay.on("closed", () => {
            this.overlay = null;
            this.overlayReady = null;
        });

        this.overlayReady = overlay
            .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`)
            .then(() => {
                this.overlay = overlay;
                return overlay;
            })
            .catch((error) => {
                // Leave nothing half-built behind: the next hold should get a fresh attempt rather
                // than a promise that has already failed.
                this.overlayReady = null;
                if (!overlay.isDestroyed()) {
                    overlay.destroy();
                }
                throw error;
            });

        return this.overlayReady;
    }
}
