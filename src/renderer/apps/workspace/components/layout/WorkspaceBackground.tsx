import { useEffect, useState } from "react";
import { useWorkspace } from "../../context";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import {
    BACKGROUND_KEYS,
    DEFAULT_BACKGROUND,
    backgroundLayerStyle,
    readBackgroundSettings,
    type BackgroundSettings,
} from "@/lib/workspace/services/ui/backgroundSettings";

/**
 * Object URLs for background images already pulled out of the main-process cache, keyed by the
 * cache file name. Names are content hashes, so an entry can never go stale — remounting the
 * workspace, or switching back to a picture used earlier this session, costs no IPC and no
 * re-decode. Module scope rather than component state because the layer unmounts whenever the
 * background is cleared. A couple of entries is all a session realistically touches; past that
 * the oldest URL is revoked so the blobs do not accumulate.
 */
const urlCache = new Map<string, string>();
const URL_CACHE_LIMIT = 4;

/** Look one up, moving it to the front of the queue so what is on screen is never what gets evicted. */
function takeCachedUrl(file: string): string | undefined {
    const url = urlCache.get(file);
    if (url) {
        urlCache.delete(file);
        urlCache.set(file, url);
    }
    return url;
}

function cacheUrl(file: string, url: string): void {
    urlCache.set(file, url);
    // Map iterates in insertion order, so the first key is the least recently used.
    while (urlCache.size > URL_CACHE_LIMIT) {
        const oldest = urlCache.keys().next().value as string;
        URL.revokeObjectURL(urlCache.get(oldest)!);
        urlCache.delete(oldest);
    }
}

/**
 * Watermark-style custom background: the picked image (stored in the userData/backgrounds cache)
 * overlays the whole window at low opacity, above the chrome but never intercepting input.
 * Overlay rather than underlay because every panel paints an opaque surface — behind them it
 * would simply be invisible. Fill mode, anchor and blur come from the settings the dialog writes.
 */
export function WorkspaceBackground() {
    const { context } = useWorkspace();
    const [settings, setSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!context) {
            return;
        }
        const globalSettings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setSettings(readBackgroundSettings(key => globalSettings.getSync(key)));
        const watched = new Set(Object.values(BACKGROUND_KEYS));
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (watched.has(change.key)) {
                setSettings(readBackgroundSettings(key => globalSettings.getSync(key)));
            }
        });
        return () => token?.cancel();
    }, [context]);

    useEffect(() => {
        const file = settings.image;
        if (!file) {
            setUrl(null);
            return;
        }
        const cached = takeCachedUrl(file);
        if (cached) {
            setUrl(cached);
            return;
        }
        let mounted = true;
        void getInterface().app.readBackgroundImage(file).then(result => {
            if (!mounted) {
                return;
            }
            if (result.success && result.data.data) {
                const created = URL.createObjectURL(new Blob([result.data.data as BlobPart]));
                cacheUrl(file, created);
                setUrl(created);
            } else {
                setUrl(null);
            }
        });
        return () => {
            mounted = false;
        };
    }, [settings.image]);

    if (!url) {
        return null;
    }

    // The outer box clips: when the picture is blurred the painted layer overhangs the window so
    // its soft edge lands outside, and that overhang must not become a scrollable area.
    return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[15] overflow-hidden">
            <div className="absolute" style={backgroundLayerStyle(settings, url)} />
        </div>
    );
}
