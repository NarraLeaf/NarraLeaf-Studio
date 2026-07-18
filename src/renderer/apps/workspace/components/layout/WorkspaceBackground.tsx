import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";

const IMAGE_KEY = "ui.backgroundImage";
const OPACITY_KEY = "ui.backgroundOpacity";

/**
 * Watermark-style custom background: the picked image (stored in userData/backgrounds) overlays
 * the whole window at low opacity, above the chrome but never intercepting input. Overlay rather
 * than underlay because every panel paints an opaque surface — behind them it would simply be
 * invisible.
 */
export function WorkspaceBackground() {
    const { context } = useWorkspace();
    const [file, setFile] = useState<string | null>(null);
    const [opacity, setOpacity] = useState(8);
    const [url, setUrl] = useState<string | null>(null);
    const urlRef = useRef<string | null>(null);

    useEffect(() => {
        if (!context) {
            return;
        }
        const settings = context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        setFile((settings.getSync(IMAGE_KEY) as string | null) ?? null);
        setOpacity(Number(settings.getSync(OPACITY_KEY)) || 8);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === IMAGE_KEY) {
                setFile((change.value as string | null) ?? null);
            } else if (change.key === OPACITY_KEY) {
                setOpacity(Number(change.value) || 8);
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
        if (!file) {
            revoke();
            setUrl(null);
            return;
        }
        void getInterface().app.readBackgroundImage(file).then(result => {
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
    }, [file]);

    if (!url) {
        return null;
    }

    return (
        <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[15] bg-cover bg-center"
            style={{ backgroundImage: `url(${url})`, opacity: Math.min(0.4, Math.max(0.02, opacity / 100)) }}
        />
    );
}
