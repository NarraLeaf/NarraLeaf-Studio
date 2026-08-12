import { useState, type ReactNode } from "react";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { useTranslation } from "@/lib/i18n";
import { getRuntimeCrashPolicy } from "./crashPolicy";

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

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(details);
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
        /* Scrolls, and only centres while there is room to.
           A game window may be 480x320, and this screen has to work there: with the details open
           its content is taller than that, and a centred flex child that overflows loses its top
           to a scrollbar that does not exist. What the player saw was the stack trace, no title,
           and a Restart button cut off above the first pixel. `min-h-full` on the centring row
           lets short content sit in the middle and tall content grow the scroll container. */
        <div className="h-screen w-screen overflow-y-auto bg-black text-white">
            <div className="flex min-h-full items-center justify-center p-8">
                <div className="w-full max-w-xl">
                    <h1 className="text-lg font-medium">{t("game.crash.title")}</h1>
                    <p className="mt-2 text-sm text-white/60">{t("game.crash.detail")}</p>

                    <button
                        type="button"
                        onClick={handleRestart}
                        className="mt-6 inline-flex min-h-9 items-center rounded-md border border-white/20 bg-white/10 px-4 text-sm text-white transition-colors hover:bg-white/20"
                    >
                        {t("game.crash.restart")}
                    </button>

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
                </div>
            </div>
        </div>
    );
}
