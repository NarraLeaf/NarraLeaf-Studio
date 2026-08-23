import { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { applyImport, planImport } from "@/lib/settings/transferSettings";
import { cn } from "@/lib/utils/cn";
import type { SettingsImportPlan } from "@shared/utils/settingsDocument";

/**
 * "I already have my settings" - the way past every question at once.
 *
 * **The same two calls the Settings window makes**, `planImport` then `applyImport`, so a document
 * is read, checked against this build's own value specs and applied one key at a time through the
 * ordinary broadcast. Nothing about importing is special-cased for a first run, including the part
 * that matters most: the plan is shown before it is applied, for exactly the reason it is shown
 * there - the file is JSON an author can edit, and applying one blind is how a settings transfer
 * becomes a settings loss.
 *
 * **On the cover, because it is about the whole run rather than any screen of it.** An import
 * answers every question at once, so when it lands setup is over:
 * {@link ImportSettingsActionProps.onImported} leaves it the same way the last screen's button does,
 * and the author arrives at the home screen with the settings they came with. It sat in the footer
 * of every screen until it was pointed out what that meant: offered beside question four, "I already
 * have all of this" reads as a way to answer question four.
 *
 * There is no export half. On a first run there is nothing yet worth writing out, and the pair
 * belongs together in Settings, where the machine being copied FROM is the one that has settings.
 */
export interface ImportSettingsActionProps {
    /** Leave setup, marker and all - the same exit the last screen's button takes. */
    onImported: () => void;
}

export function ImportSettingsAction({ onImported }: ImportSettingsActionProps) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [plan, setPlan] = useState<SettingsImportPlan | null>(null);
    const [error, setError] = useState<string | null>(null);

    const runPlan = useCallback(async () => {
        setBusy(true);
        setError(null);
        setPlan(null);
        try {
            const result = await planImport();
            if (result) {
                setPlan(result.plan);
            }
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    }, []);

    const runApply = useCallback(async () => {
        if (!plan) {
            return;
        }
        setBusy(true);
        try {
            await applyImport(plan);
            setPlan(null);
            onImported();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    }, [plan, onImported]);

    const skipped = plan
        ? plan.entries.filter(entry => entry.verdict === "unknown" || entry.verdict === "invalid").length
        : 0;
    const unchanged = plan ? plan.entries.filter(entry => entry.verdict === "same").length : 0;

    return (
        <>
            {/* The same row every question on these screens is answered with - bordered, full
                width, an icon then a label - because it is the same kind of thing: one of the
                answers setup takes. A ghost button here would be the one control in the flow that
                does not look like the flow's controls. */}
            <button
                type="button"
                disabled={busy}
                onClick={() => void runPlan()}
                className="nl-focus-ring flex w-full items-center gap-2.5 rounded-md border border-edge px-3 py-2 text-left text-fg-muted transition-colors duration-150 hover:bg-fill disabled:opacity-60"
            >
                <Upload className="h-4 w-4 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-sm">{t("onboarding.import.action")}</span>
            </button>

            {error && !plan ? <span className="truncate text-xs text-danger">{error}</span> : null}

            <Modal
                isOpen={plan !== null}
                onClose={() => setPlan(null)}
                title={t("onboarding.import.action")}
                size="sm"
                footer={(
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                            disabled={busy}
                            onClick={() => setPlan(null)}
                        >
                            {t("common.cancel")}
                        </button>
                        <button
                            type="button"
                            className={dialogFooterButtonClass({
                                variant: "primary",
                                disabled: busy || !plan || plan.applicable.length === 0,
                            })}
                            disabled={busy || !plan || plan.applicable.length === 0}
                            onClick={() => void runApply()}
                        >
                            {t("settings.transfer.apply")}
                        </button>
                    </div>
                )}
            >
                {plan && (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs text-fg-muted">
                            {t("settings.transfer.planSummary", {
                                change: String(plan.applicable.length),
                                same: String(unchanged),
                                skipped: String(skipped),
                            })}
                        </p>
                        <p className="text-xs text-fg-subtle">{t("onboarding.import.leaves")}</p>
                        {plan.applicable.length > 0 && (
                            // Key and incoming value. The "before" of every row is what the screen
                            // behind this dialog is already showing.
                            <div className="max-h-56 overflow-y-auto rounded-md border border-edge bg-fill-subtle p-2">
                                {plan.applicable.map(entry => (
                                    <div key={entry.key} className="flex h-5 items-center gap-2 text-2xs">
                                        <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.key}</span>
                                        <span className="min-w-0 max-w-40 truncate text-fg">{formatValue(entry.incoming)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {error ? <p className={cn("truncate text-xs text-danger")}>{error}</p> : null}
                    </div>
                )}
            </Modal>
        </>
    );
}

/**
 * A value as one short line, the way the settings window prints one. Whole objects are summarized
 * rather than dumped; an unset value renders as nothing at all, which is what it means.
 */
function formatValue(value: unknown): string {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value || "\"\"";
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.length}]`;
    }
    return "{…}";
}
