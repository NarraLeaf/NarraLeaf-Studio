import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
    closeCommandPalette,
    forwardCommandPaletteKey,
    openCommandPalette,
    setCommandPaletteBoxPresent,
    setCommandPaletteQuery,
    subscribeCommandPaletteSession,
    type PaletteSessionState,
} from "./commandPaletteController";
import { compositionHandlers, isComposingText } from "./imeComposition";

/** Shared pill chrome for both states, so opening never visually jumps. */
const PILL_CLASS =
    "flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-3 text-xs";

/**
 * VSCode-style title-bar search box. Idle it is a centered pill; once a palette session starts
 * (click here, `mod+p`, `mod+shift+p`) the same pill becomes a real text input — same size, same
 * spot — and you type right in it while the candidate list drops below. All session logic lives
 * in CommandPalette; this is a controlled view wired through `commandPaletteController`.
 */
export function TitleBarSearchBox() {
    const { t } = useTranslation();
    const [session, setSession] = useState<PaletteSessionState>({ open: false, query: "" });
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => subscribeCommandPaletteSession(setSession), []);

    // Tell the palette it has somewhere to type; unmounting (setting turned off) makes the palette
    // fall back to its own input.
    useEffect(() => {
        setCommandPaletteBoxPresent(true);
        return () => setCommandPaletteBoxPresent(false);
    }, []);

    // Grab keyboard focus whenever a session starts, with the caret after any prefilled `>`.
    useEffect(() => {
        if (!session.open) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const input = inputRef.current;
            if (input && document.activeElement !== input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [session.open]);

    return (
        <div data-titlebar-search-box className="no-drag w-full max-w-[720px] min-w-0">
            {session.open ? (
                <div className={`${PILL_CLASS} bg-surface-raised text-fg`}>
                    <Search className="h-3 w-3 shrink-0 text-fg-subtle" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={session.query}
                        placeholder={t("workspace.shell.search.titleBarPlaceholder")}
                        aria-label={t("workspace.shell.commandPalette.title")}
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                        className="h-full min-w-0 flex-1 bg-transparent text-left text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                        onChange={event => setCommandPaletteQuery(event.target.value)}
                        onKeyDown={forwardCommandPaletteKey}
                        {...compositionHandlers}
                        // Focus moving anywhere else ends the session. Result-row clicks prevent
                        // mousedown default, so they commit before any blur can fire. An IME
                        // candidate window also blurs us — keep the session and the focus.
                        onBlur={() => {
                            if (isComposingText()) {
                                inputRef.current?.focus();
                                return;
                            }
                            closeCommandPalette();
                        }}
                    />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => openCommandPalette("")}
                    title={t("workspace.shell.search.titleBarPlaceholder")}
                    aria-label={t("workspace.shell.search.titleBarPlaceholder")}
                    className={`${PILL_CLASS} cursor-default justify-center text-fg-subtle transition-colors hover:bg-fill hover:text-fg-muted`}
                >
                    <Search className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t("workspace.shell.search.titleBarPlaceholder")}</span>
                </button>
            )}
        </div>
    );
}
