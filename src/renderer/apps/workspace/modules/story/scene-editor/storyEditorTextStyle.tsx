import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getInterface } from "@/lib/app/bridge";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
} from "@/lib/settings/editorFontOptions";

/**
 * Display font for authored story text (dialogue / narration / choice / note) in the scene editor.
 *
 * This is a Studio *preference* backed by global.json `editor.fontSize` / `editor.fontFamily`.
 * It is distinct from per-run `StoryTextMarks.fontSize`, which is story *content* compiled into the
 * runtime — content marks stay absolute and continue to override this base per run.
 */

// Font-family option key -> CSS font-family stack. "Default" inherits the surrounding Studio UI font
// (the app does not bundle a dedicated editor typeface, so "Default" is the honest baseline).
const FONT_FAMILY_STACKS: Record<string, string> = {
    "Default": "inherit",
    "Sans Serif": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
    "Serif": "ui-serif, Georgia, \"Times New Roman\", serif",
    "Monospace": "ui-monospace, \"SF Mono\", \"Cascadia Code\", \"Fira Code\", Menlo, monospace",
};

function clampFontSize(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return EDITOR_FONT_SIZE_DEFAULT;
    }
    return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(numeric)));
}

function resolveFontFamily(value: unknown): string {
    if (typeof value === "string" && value in FONT_FAMILY_STACKS) {
        return FONT_FAMILY_STACKS[value];
    }
    return FONT_FAMILY_STACKS[EDITOR_FONT_FAMILY_DEFAULT];
}

function toStyle(fontSize: number, fontFamily: string): CSSProperties {
    return { fontSize, fontFamily };
}

const DEFAULT_STYLE = toStyle(EDITOR_FONT_SIZE_DEFAULT, resolveFontFamily(EDITOR_FONT_FAMILY_DEFAULT));

const StoryEditorTextStyleContext = createContext<CSSProperties>(DEFAULT_STYLE);

/**
 * The inline style to spread onto story text surfaces (`fontSize` + `fontFamily`). Defaults to the
 * baseline when used outside a provider, so components render sensibly in isolation.
 */
export function useStoryEditorTextStyle(): CSSProperties {
    return useContext(StoryEditorTextStyleContext);
}

/**
 * Reads the editor font preference once and shares it with every story text surface below. Re-reads
 * when the workspace window regains focus, so a change made in the (separate) Settings window
 * applies as soon as the author returns to the editor — without any cross-window IPC push.
 */
export function StoryEditorTextStyleProvider({ children }: { children: ReactNode }) {
    const [fontSize, setFontSize] = useState(EDITOR_FONT_SIZE_DEFAULT);
    const [fontFamily, setFontFamily] = useState(() => resolveFontFamily(EDITOR_FONT_FAMILY_DEFAULT));

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [sizeResult, familyResult] = await Promise.all([
                    getInterface().app.state.getGlobalState("editor.fontSize"),
                    getInterface().app.state.getGlobalState("editor.fontFamily"),
                ]);
                if (cancelled) {
                    return;
                }
                setFontSize(clampFontSize(sizeResult.success ? sizeResult.data.value : undefined));
                setFontFamily(resolveFontFamily(familyResult.success ? familyResult.data.value : undefined));
            } catch {
                // Keep the last known-good values on transient IPC failures.
            }
        };
        void load();
        const onFocus = () => { void load(); };
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    const style = useMemo(() => toStyle(fontSize, fontFamily), [fontSize, fontFamily]);
    return (
        <StoryEditorTextStyleContext.Provider value={style}>
            {children}
        </StoryEditorTextStyleContext.Provider>
    );
}
