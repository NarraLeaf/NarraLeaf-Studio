import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";

type Props = {
    code: string;
    onChange: (code: string) => void;
    debounceMs?: number;
};

/**
 * TypeScript Blueprint source editor (Monaco deferred; textarea matches Studio chrome).
 */
export function TypeScriptBlueprintEditorPane({ code, onChange, debounceMs = 400 }: Props) {
    const { t } = useTranslation();
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
        <div className="flex h-full min-h-0 flex-col border border-edge bg-surface-sunken">
            <textarea
                className="min-h-0 flex-1 resize-none bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed text-fg outline-none focus:ring-1 focus:ring-primary/40"
                spellCheck={false}
                value={draft}
                onChange={onInput}
                title={t("blueprint.tsPane.importHint")}
                aria-label={t("blueprint.tsPane.sourceLabel")}
            />
        </div>
    );
}
