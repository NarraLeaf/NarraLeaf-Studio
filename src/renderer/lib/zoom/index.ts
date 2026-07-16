import { getInterface } from "@/lib/app/bridge";
import { zoomPercentToFactor } from "@shared/constants/zoom";

/**
 * Mirror `ui.zoomPercent` onto the `--nl-zoom` CSS variable.
 *
 * Almost nothing needs this: `webContents.setZoomFactor` scales the whole page,
 * so ordinary CSS keeps its proportions for free. It exists for the one thing
 * zoom does NOT scale — the macOS traffic lights, which the OS draws at a fixed
 * physical size. The titlebar reserves room for them with `calc(… / var(--nl-zoom))`
 * so that gap stays a constant number of real pixels at any zoom.
 *
 * Unlike the theme (pure CSS via prefers-color-scheme), CSS has no way to ask for
 * the zoom factor, so this reads the setting and follows the main process's
 * broadcast — the same pattern the i18n locale uses.
 */
let subscribed = false;

function apply(percent: unknown): void {
    document.documentElement.style.setProperty("--nl-zoom", String(zoomPercentToFactor(percent)));
}

export async function initZoom(): Promise<void> {
    try {
        const result = await getInterface().app.state.getGlobalState("ui.zoomPercent");
        if (result.success) {
            apply(result.data.value);
        }
    } catch (error) {
        console.warn("[zoom] Failed to load the zoom preference; using 100%.", error);
    }

    if (!subscribed) {
        subscribed = true;
        getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (change.key === "ui.zoomPercent") {
                apply(change.value);
            }
        });
    }
}
