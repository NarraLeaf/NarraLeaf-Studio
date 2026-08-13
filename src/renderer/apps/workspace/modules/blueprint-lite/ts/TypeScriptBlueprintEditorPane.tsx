import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

type Props = {
    code: string;
    onChange: (code: string) => void;
    debounceMs?: number;
};

/**
 * TypeScript Blueprint source editor (Monaco deferred; textarea matches Studio chrome).
 *
 * **`readOnly` rather than `disabled` while the workspace is frozen**, which is the opposite of what
 * the rest of this pass does and is right here for two reasons: a disabled textarea is greyed to the
 * point of being hard to read, and reading the source is the entire reason to open a past version of
 * a script. `readOnly` keeps the text selectable and copyable and refuses every keystroke.
 *
 * The debounce below is the second half: it commits on a timer rather than on the keystroke, so a
 * freeze landing mid-edit would otherwise fire one last write after the author could no longer see
 * they were typing. It is skipped while frozen for the same reason `toReadOnlyDockerBarItems` marks
 * its number fields `readOnly` as well as `disabled`.
 */
export function TypeScriptBlueprintEditorPane({ code, onChange, debounceMs = 400 }: Props) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [draft, setDraft] = useState(code);

    useEffect(() => {
        setDraft(code);
    }, [code]);

    useEffect(() => {
        if (freeze.frozen) {
            return;
        }
        const t = window.setTimeout(() => {
            if (draft !== code) {
                onChange(draft);
            }
        }, debounceMs);
        return () => window.clearTimeout(t);
    }, [draft, code, onChange, debounceMs, freeze.frozen]);

    const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(e.target.value);
    }, []);

    return (
        <div className="flex h-full min-h-0 flex-col border border-edge bg-surface-sunken">
            <textarea
                className="min-h-0 flex-1 resize-none bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:ring-1 focus:ring-primary/40"
                spellCheck={false}
                value={draft}
                onChange={onInput}
                readOnly={freeze.frozen}
                data-tip={freeze.frozen ? freeze.reason : t("blueprint.tsPane.importHint")}
                aria-label={t("blueprint.tsPane.sourceLabel")}
            />
        </div>
    );
}
