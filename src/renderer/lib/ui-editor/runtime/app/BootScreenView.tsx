import type { ReactNode } from "react";
import { translate } from "@/lib/i18n";

/**
 * What a game shows before it can show itself - drawn, not decided.
 *
 * Two places wait on the same thing and draw it the same way: the packaged game while it reads its
 * pack and warms its first screen (`RuntimeBootScreen`, which feeds this from the boot progress
 * store), and a Dev Mode window while it warms the screen it opens on. One component, so the author
 * testing their game waits in exactly the frame their players will.
 *
 * Two decisions are the whole design:
 *
 * - **The colour is the game's, not this screen's.** It is the colour of the screen that arrives
 *   next, so the reveal is the interface appearing rather than the window changing colour.
 * - **Nothing is written on it.** A loading screen that talks needs an author to translate it, and
 *   an author who never asked for it cannot. The one string is the indicator's accessible name,
 *   which comes from the catalogue the shell already carries and is read to nobody who can see.
 */
export type BootScreenProgress = {
    /** Assets settled so far, when the phase can count them. */
    loaded?: number;
    /** How many there are to settle; zero or absent means the phase cannot be measured. */
    total?: number;
};

export function BootScreenView({ background, accent, lang, progress, placement }: {
    background: string;
    /** The indicator's ink: whatever reads against `background`, which is all this mark has to do. */
    accent: string;
    /** The shell's language, for the one label here. The document around it belongs to the game. */
    lang?: string;
    progress: BootScreenProgress;
    /**
     * `window` covers the whole window, which is what a packaged game is. `contained` covers the box
     * it is placed in - a Dev Mode window keeps its own chrome on screen while its stage warms, so a
     * session error has somewhere to be read.
     */
    placement: "window" | "contained";
}): ReactNode {
    const total = progress.total ?? 0;
    const loaded = progress.loaded;
    const determinate = total > 0 && loaded !== undefined;
    const percent = determinate
        ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100)))
        : 0;
    const barColor = `color-mix(in srgb, ${accent} 55%, transparent)`;

    return (
        /* `lang` sits on this element and nowhere higher, for the reason the crash screen states:
           the document belongs to the game, and its language is the author's. Nothing here is read
           aloud except the label below, which is the shell speaking. */
        <div
            lang={lang}
            className={`${placement === "window" ? "fixed" : "absolute"} inset-0 z-50 flex items-end justify-center`}
            style={{ backgroundColor: background }}
        >
            {/* Low rather than centred: a bar in the middle of the screen is a thing to look at,
                and this is a thing to notice. The width is fixed and small so it reads the same on
                a 480px window and a 4K one. */}
            <div className="mb-[14vh] w-40 max-w-[40vw]">
                <div
                    className="relative h-0.5 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)` }}
                    role="progressbar"
                    aria-label={translate("common.loading")}
                    aria-valuemin={determinate ? 0 : undefined}
                    aria-valuemax={determinate ? 100 : undefined}
                    aria-valuenow={determinate ? percent : undefined}
                >
                    {determinate ? (
                        <div
                            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                            style={{
                                width: `${percent}%`,
                                backgroundColor: barColor,
                            }}
                        />
                    ) : (
                        // The two-bar sweep the rest of the product uses for work it cannot measure
                        // (`animate-progress-indeterminate-*` in tailwind.config.js). A boot phase
                        // reports its boundaries and not its progress, so every phase but an asset
                        // warm-up is this case - and a bar that sat still would be the black window
                        // again, only thinner.
                        <>
                            <div
                                className="absolute inset-y-0 animate-progress-indeterminate-1 rounded-full"
                                style={{ backgroundColor: barColor }}
                            />
                            <div
                                className="absolute inset-y-0 animate-progress-indeterminate-2 rounded-full"
                                style={{ backgroundColor: barColor }}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
