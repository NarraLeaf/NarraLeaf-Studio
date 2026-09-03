import { useSyncExternalStore, type ReactNode } from "react";
import { translate } from "@/lib/i18n";
import { getRuntimeBootProgress, subscribeRuntimeBootProgress } from "./bootProgress";
import { getShellLocale } from "./shellLocale";

/**
 * What a game shows before it can show itself.
 *
 * A shipped game does real work before its first frame - it reads its pack, compiles the story and
 * warms the pictures the opening screen needs - and until this existed it did all of it behind a
 * bare black div. On a full-length project that is several seconds in which nothing on screen says
 * the game is coming, which is indistinguishable from a game that has hung.
 *
 * Two decisions are the whole design:
 *
 * - **The colour is the game's, not this screen's.** It comes from the built pack's palette (see
 *   `resolveRuntimeBootBackground`), so the wait is painted in the same colour the title screen
 *   arrives in and the reveal is the interface appearing rather than the window changing colour.
 * - **Nothing is written on it.** A loading screen that talks needs an author to translate it, and
 *   an author who never asked for it cannot. The one string is the indicator's accessible name,
 *   which comes from the catalogue the shell already carries and is read to nobody who can see.
 *
 * There is nothing to configure. A game either has this or has a black window, and no author wants
 * the second.
 */

/** The bare colour, with no indicator: what is under the game while it has nothing to draw. */
export function RuntimeBootBackdrop({ background }: { background: string }): ReactNode {
    return <div className="h-screen w-screen" style={{ backgroundColor: background }} />;
}

export function RuntimeBootScreen({ background, accent }: {
    background: string;
    /**
     * The indicator's colour, from the palette rather than white: an author whose game is pale
     * would otherwise get a bar they cannot see on their own background. The shell passes the
     * project's `foreground`, which is by definition what is legible against its `background`.
     */
    accent: string;
}): ReactNode {
    const progress = useSyncExternalStore(subscribeRuntimeBootProgress, getRuntimeBootProgress);
    if (progress.phase === "firstFrame") {
        return null;
    }

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
            lang={getShellLocale()}
            className="fixed inset-0 z-50 flex items-end justify-center"
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
                        // (`animate-progress-indeterminate-*` in tailwind.config.js). The engine's
                        // preload reports its boundaries and not its progress, so every phase but
                        // the asset warm-up is this case - and a bar that sat still would be the
                        // black window again, only thinner.
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
