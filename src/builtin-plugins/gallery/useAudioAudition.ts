import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginApp } from "narraleaf-studio/plugin";
import { createGalleryTranslator } from "./messages";

/** Play one editor-side audio preview at a time. */
export function useAudioAudition(app: PluginApp, loadAudioUrl: (assetId: string) => Promise<string>) {
    const [playingKey, setPlayingKey] = useState<string | null>(null);
    const elementRef = useRef<HTMLAudioElement | null>(null);
    const generationRef = useRef(0);

    const stop = useCallback(() => {
        generationRef.current += 1;
        const element = elementRef.current;
        elementRef.current = null;
        if (element) {
            element.onended = null;
            element.pause();
        }
        setPlayingKey(null);
    }, []);

    useEffect(() => stop, [stop]);

    const toggle = useCallback(async (key: string, assetId: string | null | undefined) => {
        if (playingKey === key) {
            stop();
            return;
        }
        stop();
        if (!assetId) {
            return;
        }
        const generation = generationRef.current;
        try {
            const url = await loadAudioUrl(assetId);
            if (generation !== generationRef.current) {
                return;
            }
            const element = new Audio(url);
            element.onended = () => {
                if (elementRef.current === element) {
                    elementRef.current = null;
                    setPlayingKey(null);
                }
            };
            elementRef.current = element;
            setPlayingKey(key);
            await element.play();
        } catch (error) {
            if (generation !== generationRef.current) {
                return;
            }
            stop();
            app.services.ui.notifications.error(createGalleryTranslator(app).t("playFailed", {
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [app, loadAudioUrl, playingKey, stop]);

    return { playingKey, toggle, stop };
}
