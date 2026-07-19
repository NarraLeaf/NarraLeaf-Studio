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
import type { ChangeEvent, CompositionEvent } from "react";

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
    // The input is controlled by this local draft, not by `session.query` directly: the query round-trips
    // through the palette and back over an effect, so a render with the *previous* query lands between the
    // keystroke and the echo. React restores `input.value` from that stale render at the end of the event,
    // and a write to `value` mid-composition tears down the IME's buffer — CJK text comes out scrambled.
    // Typing updates the draft in the same commit as the event, so the DOM is never rewound.
    const [draft, setDraft] = useState("");
    const composingRef = useRef(false);

    useEffect(() => subscribeCommandPaletteSession(setSession), []);

    // Adopt query changes the palette made itself (opening with a prefilled `>`, the "go to commands"
    // row), never while composing — that is exactly the write the draft exists to avoid.
    useEffect(() => {
        if (!composingRef.current) {
            setDraft(session.query);
        }
    }, [session.query, session.open]);

    const publish = (value: string) => {
        setDraft(value);
        // Mid-composition the query is half-typed pinyin; let the list wait for the committed characters.
        if (!composingRef.current) {
            setCommandPaletteQuery(value);
        }
    };

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
                        value={draft}
                        placeholder={t("workspace.shell.search.titleBarPlaceholder")}
                        aria-label={t("workspace.shell.commandPalette.title")}
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                        className="h-full min-w-0 flex-1 bg-transparent text-left text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
                        onChange={(event: ChangeEvent<HTMLInputElement>) => publish(event.target.value)}
                        onKeyDown={forwardCommandPaletteKey}
                        onCompositionStart={() => {
                            composingRef.current = true;
                            compositionHandlers.onCompositionStart();
                        }}
                        onCompositionEnd={(event: CompositionEvent<HTMLInputElement>) => {
                            composingRef.current = false;
                            compositionHandlers.onCompositionEnd();
                            // The composed characters landed in the DOM during the guarded window; hand
                            // the finished string to the palette now.
                            publish(event.currentTarget.value);
                        }}
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
