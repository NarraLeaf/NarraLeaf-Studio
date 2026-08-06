import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import {
    EDITOR_LINE_NUMBERS_DEFAULT,
    EDITOR_LINE_NUMBERS_KEY,
    EDITOR_SOFT_WRAP_DEFAULT,
    EDITOR_SOFT_WRAP_KEY,
    resolveBooleanSetting,
    TEXT_EDITOR_VIEW_DEFAULTS,
    type TextEditorViewOptions,
} from "@/lib/settings/textEditorOptions";

/**
 * The built-in text editor's two view preferences, applied live.
 *
 * Follows the global-state broadcast rather than re-reading on window focus (the older
 * `useStoryRowHighlight` idiom): the Settings window is a separate window, so a toggle there
 * would otherwise sit invisible until the author clicked back into the workspace, with the
 * gutter appearing under their cursor a moment later. An absent value resolves to the default
 * - which is also what a reset writes, so the two paths agree by construction.
 */
export function useTextEditorViewOptions(): TextEditorViewOptions {
    const [options, setOptions] = useState<TextEditorViewOptions>(TEXT_EDITOR_VIEW_DEFAULTS);

    useEffect(() => {
        let cancelled = false;
        const read = async (key: string, fallback: boolean): Promise<boolean> => {
            try {
                const result = await getInterface().app.state.getGlobalState(key);
                return resolveBooleanSetting(result.success ? result.data.value : undefined, fallback);
            } catch {
                return fallback;
            }
        };

        void (async () => {
            const [lineNumbers, softWrap] = await Promise.all([
                read(EDITOR_LINE_NUMBERS_KEY, EDITOR_LINE_NUMBERS_DEFAULT),
                read(EDITOR_SOFT_WRAP_KEY, EDITOR_SOFT_WRAP_DEFAULT),
            ]);
            if (!cancelled) {
                setOptions({ lineNumbers, softWrap });
            }
        })();

        const token = getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (change.key === EDITOR_LINE_NUMBERS_KEY) {
                setOptions(prev => ({
                    ...prev,
                    lineNumbers: resolveBooleanSetting(change.value, EDITOR_LINE_NUMBERS_DEFAULT),
                }));
            } else if (change.key === EDITOR_SOFT_WRAP_KEY) {
                setOptions(prev => ({
                    ...prev,
                    softWrap: resolveBooleanSetting(change.value, EDITOR_SOFT_WRAP_DEFAULT),
                }));
            }
        });

        return () => {
            cancelled = true;
            token?.cancel();
        };
    }, []);

    return options;
}
