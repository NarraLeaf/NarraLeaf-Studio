import { useMemo } from "react";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    EDITOR_LINE_NUMBERS_DEFAULT,
    EDITOR_LINE_NUMBERS_KEY,
    EDITOR_SOFT_WRAP_DEFAULT,
    EDITOR_SOFT_WRAP_KEY,
    resolveBooleanSetting,
    type TextEditorViewOptions,
} from "@/lib/settings/textEditorOptions";

/**
 * The built-in text editor's two view preferences, applied live.
 *
 * Both follow the global-state broadcast (see {@link useGlobalSetting}): the Settings window is a
 * separate window, so a toggle there would otherwise sit invisible until the author clicked back
 * into the workspace, with the gutter appearing under their cursor a moment later. An absent value
 * resolves to the default - which is also what a reset broadcasts, so the two paths agree by
 * construction.
 */
export function useTextEditorViewOptions(): TextEditorViewOptions {
    const lineNumbers = useGlobalSetting(EDITOR_LINE_NUMBERS_KEY, stored =>
        resolveBooleanSetting(stored, EDITOR_LINE_NUMBERS_DEFAULT));
    const softWrap = useGlobalSetting(EDITOR_SOFT_WRAP_KEY, stored =>
        resolveBooleanSetting(stored, EDITOR_SOFT_WRAP_DEFAULT));

    return useMemo(() => ({ lineNumbers, softWrap }), [lineNumbers, softWrap]);
}
