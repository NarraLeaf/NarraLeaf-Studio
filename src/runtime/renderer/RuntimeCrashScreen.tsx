import { useState, type ReactNode } from "react";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { useTranslation } from "@/lib/i18n";
import { getShellLocale } from "./shellLocale";
import { canSaveCrashReport, saveCrashReport } from "./crashReport";
import { getRuntimeCrashPolicy, getRuntimeShellLogPath } from "./crashPolicy";

interface RuntimeCrashScreenProps {
    /** The failure, already flattened. Carries a stack when there was one. */
    details: string;
    /** Called instead of a plain page reload where the shell has a better way back. */
    onRestart?: () => void;
}

/**
 * What the game shows when it cannot carry on drawing.
 *
 * Before this there was nothing: a throw inside the game unmounted React and left the player
 * looking at a black window, with no message, no way back in, and no reason to think their saves
 * had survived. So the two things a player actually needs are stated outright - saves are intact,
 * and this is how you get back - and the failure itself is one disclosure away, because the person
 * who can act on it is whoever they send it to.
 *
 * Restarting is a page reload rather than anything cleverer. The game reopens at its title screen
 * with every save on disk untouched, which is the honest promise; trying to resume from a tree
 * that has just thrown would be a guess about state nobody can check.
 *
 * The report button is the last step of that: showing the failure and naming the log left the player
 * with a folder path and a clipboard, and the author with whatever they managed to paste. It writes
 * one file - the log plus what the build knows about itself - and shows it to them in their file
 * manager, on their own machine and nowhere else. It is drawn only where the shell can actually
 * write one, and nothing else on this screen depends on it: a write that fails leaves the copy
 * button and the log path exactly as they are.
 */
export function RuntimeCrashScreen({ details, onRestart }: RuntimeCrashScreenProps): ReactNode {
    const { t } = useTranslation();
    const [copyState, setCopyState] = useState<{ ok: boolean; text: string } | null>(null);
    /**
     * Read at render rather than taken as a prop: every caller would have to pass the same value
     * through, and one that forgot would be a build quietly showing a player what its author asked
     * to keep to the log. Under `restart` this screen is only reached once restarting has been
     * given up on, and what is wanted then is the message without the stack.
     */
    const showDetails = getRuntimeCrashPolicy() === "details";
    /**
     * Shown under every policy, including the one that keeps the error off the screen - especially
     * that one. A player who is not being shown what went wrong is exactly the player who needs to
     * be able to hand the file to somebody who can read it.
     *
     * Read from the page's address rather than from the bridge, because the screen that most needs
     * to name the log is the one drawn when the preload never ran - and that is exactly when there
     * is no bridge to ask. Absent on the web export, which has no log file to name.
     */
    const logPath = getRuntimeShellLogPath();
    /**
     * Asked once, at render: a shell either has somewhere to write a file or it does not, and the
     * answer cannot change while this screen is up. False on the web export and wherever the preload
     * never ran, and the screen then draws no button at all - an affordance that cannot work is
     * worse than none, and everything else here is untouched by its absence.
     */
    const [canSaveReport] = useState(canSaveCrashReport);
    const [reportState, setReportState] = useState<{ ok: boolean; text: string } | null>(null);
    const [savingReport, setSavingReport] = useState(false);

    const handleSaveReport = async () => {
        setSavingReport(true);
        const result = await saveCrashReport(details);
        setSavingReport(false);
        setReportState(result.outcome === "written"
            ? { ok: true, text: t("game.crash.reportSaved", { path: result.path }) }
            : { ok: false, text: t("game.crash.reportFailed", { error: result.error }) });
    };

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(logPath ? `${details}

${t("game.crash.logAt", { path: logPath })}` : details);
            setCopyState({ ok: true, text: t("game.crash.copied") });
        } catch (error) {
            setCopyState({
                ok: false,
                text: t("game.crash.copyFailed", {
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        }
    };

    const handleRestart = () => {
        if (onRestart) {
            onRestart();
            return;
        }
        window.location.reload();
    };

    return (
        /* `lang` is set here and nowhere higher: it decides which Han forms the browser draws, and
           the document belongs to the game, whose language is the author's and the player's, not
           this screen's. Scoping it to the screen keeps the shell in the machine's language without
           touching a single glyph of the game.

           Scrolls, and only centres while there is room to.
           A game window may be 480x320, and this screen has to work there: with the details open
           its content is taller than that, and a centred flex child that overflows loses its top
           to a scrollbar that does not exist. What the player saw was the stack trace, no title,
           and a Restart button cut off above the first pixel. `min-h-full` on the centring row
           lets short content sit in the middle and tall content grow the scroll container. */
        <div lang={getShellLocale()} className="h-screen w-screen overflow-y-auto bg-black text-white">
            <div className="flex min-h-full items-center justify-center p-8">
                <div className="w-full max-w-xl">
                    <h1 className="text-lg font-medium">{t("game.crash.title")}</h1>
                    <p className="mt-2 text-sm text-white/60">{t("game.crash.detail")}</p>

                    {/* Wraps, because a 480px window is a size this screen has to work at and two
                        buttons on one line do not fit there. */}
                    <div className="mt-6 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleRestart}
                            className="inline-flex min-h-9 items-center rounded-md border border-white/20 bg-white/10 px-4 text-sm text-white transition-colors hover:bg-white/20"
                        >
                            {t("game.crash.restart")}
                        </button>
                        {canSaveReport && (
                            <button
                                type="button"
                                onClick={() => void handleSaveReport()}
                                disabled={savingReport}
                                className="inline-flex min-h-9 items-center rounded-md border border-white/20 px-4 text-sm text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                                {t("game.crash.saveReport")}
                            </button>
                        )}
                    </div>
                    {reportState && (
                        <p
                            className={`nl-selectable-text mt-3 select-text break-all text-xs ${reportState.ok ? "text-white/50" : "text-red-300"}`}
                            role="status"
                        >
                            {reportState.text}
                        </p>
                    )}

                    {showDetails && (
                        <details className="mt-6">
                            <summary className="cursor-default text-xs text-white/50 hover:text-white/80">
                                {t("game.crash.showDetails")}
                            </summary>
                            {/* Selectable, because a player who cannot copy can still drag across it. */}
                            <pre className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-white/70">
                                {details}
                            </pre>
                            <button
                                type="button"
                                onClick={() => void handleCopy()}
                                className="mt-2 text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
                            >
                                {t("game.crash.copyDetails")}
                            </button>
                            {copyState && (
                                <p className={`mt-2 text-xs ${copyState.ok ? "text-white/50" : "text-red-300"}`} role="status">
                                    {copyState.text}
                                </p>
                            )}
                        </details>
                    )}

                    {logPath && (
                        <p className="nl-selectable-text mt-6 select-text break-all font-mono text-xs text-white/40">
                            {t("game.crash.logAt", { path: logPath })}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
