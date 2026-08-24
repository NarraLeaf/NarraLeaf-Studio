import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { getShellLocale } from "./shellLocale";

/**
 * What a second tab of a web export shows instead of the game.
 *
 * Both tabs would be writing to one store - the same save slots, the same persistent variables -
 * and the player would find out when a slot they saved in one is something else in the other. The
 * desktop shells never reach this: their main process raises the window that is already open
 * rather than starting a second copy.
 *
 * Drawn like the crash screen and for the same reasons: the shell's own voice, in the machine's
 * language rather than the game's (the game has not booted, so it has no language yet), scoped to
 * this element so the document's own remains the game's. It scrolls and only centres while there is
 * room to, which is what a 480x320 window needs.
 */
export function RuntimeSessionTakenScreen(): ReactNode {
    const { t } = useTranslation();
    return (
        <div lang={getShellLocale()} className="h-screen w-screen overflow-y-auto bg-black text-white">
            <div className="flex min-h-full items-center justify-center p-8">
                <div className="w-full max-w-xl">
                    <h1 className="text-lg font-medium">{t("game.session.title")}</h1>
                    <p className="mt-2 text-sm text-white/60">{t("game.session.detail")}</p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-6 inline-flex min-h-9 items-center rounded-md border border-white/20 bg-white/10 px-4 text-sm text-white transition-colors hover:bg-white/20"
                    >
                        {t("game.session.reload")}
                    </button>
                </div>
            </div>
        </div>
    );
}
