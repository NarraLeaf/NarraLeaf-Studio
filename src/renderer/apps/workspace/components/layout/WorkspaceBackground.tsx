import { useEffect, useRef, useState } from "react";
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
 * Watermark-style custom background: the picked image (stored in userData/backgrounds) overlays
 * the whole window at low opacity, above the chrome but never intercepting input. Overlay rather
 * than underlay because every panel paints an opaque surface — behind them it would simply be
 * invisible. Fill mode and anchor come from the same settings the dialog writes.
 */
export function WorkspaceBackground() {
    const { context } = useWorkspace();
    const [settings, setSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
    const [url, setUrl] = useState<string | null>(null);
    const urlRef = useRef<string | null>(null);

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
        let mounted = true;
        const revoke = () => {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
        if (!settings.image) {
            revoke();
            setUrl(null);
            return;
        }
        void getInterface().app.readBackgroundImage(settings.image).then(result => {
            if (!mounted) {
                return;
            }
            revoke();
            if (result.success && result.data.data) {
                const blob = new Blob([result.data.data as BlobPart]);
                urlRef.current = URL.createObjectURL(blob);
                setUrl(urlRef.current);
            } else {
                setUrl(null);
            }
        });
        return () => {
            mounted = false;
            revoke();
        };
    }, [settings.image]);

    if (!url) {
        return null;
    }

    return (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[15]" style={backgroundLayerStyle(settings, url)} />
    );
}
