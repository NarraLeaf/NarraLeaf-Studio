import { useEffect, useState } from "react";
import { useWorkspace } from "../../context";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import {
    BACKGROUND_KEYS,
    DEFAULT_BACKGROUND,
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
 * The custom workspace background: the settings the dialog writes, and an object URL for the picked
 * image (or null when none is set, or while it is still being read out of the userData cache).
 *
 * Where the picture is *painted* is the caller's business — it is drawn as the backdrop of the
 * empty editor area, behind opaque content, never as an overlay on top of the chrome. Overlaying it
 * washed out every panel and editor below it; keeping it strictly behind opaque surfaces is what
 * lets real content (a scene's background image, panels, toolbars) stay fully opaque.
 */
export function useWorkspaceBackgroundImage(): { settings: BackgroundSettings; url: string | null } {
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

    return { settings, url };
}
