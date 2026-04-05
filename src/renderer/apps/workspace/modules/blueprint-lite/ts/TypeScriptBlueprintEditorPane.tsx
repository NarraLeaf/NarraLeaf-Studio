import { useCallback, useEffect, useState } from "react";

type Props = {
    code: string;
    onChange: (code: string) => void;
    debounceMs?: number;
};

/**
 * TypeScript Blueprint source editor (Monaco deferred; textarea matches Studio dark chrome).
 */
export function TypeScriptBlueprintEditorPane({ code, onChange, debounceMs = 400 }: Props) {
    const [draft, setDraft] = useState(code);

    useEffect(() => {
        setDraft(code);
    }, [code]);

    useEffect(() => {
        const t = window.setTimeout(() => {
            if (draft !== code) {
                onChange(draft);
            }
        }, debounceMs);
        return () => window.clearTimeout(t);
    }, [draft, code, onChange, debounceMs]);

    const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(e.target.value);
    }, []);

    return (
        <div className="flex h-full min-h-[320px] flex-col border border-white/10 bg-[#0a0b0c]">
            <div className="shrink-0 border-b border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500">
                Source · allowed import: <span className="font-mono text-cyan-400/90">narraleaf-studio</span>
            </div>
            <textarea
                className="min-h-0 flex-1 resize-none bg-[#0a0b0c] p-3 font-mono text-[12px] leading-relaxed text-gray-200 outline-none focus:ring-1 focus:ring-cyan-500/40"
                spellCheck={false}
                value={draft}
                onChange={onInput}
                aria-label="TypeScript blueprint source"
            />
        </div>
    );
}
