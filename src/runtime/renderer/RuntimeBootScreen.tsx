import { useSyncExternalStore, type ReactNode } from "react";
import { BootScreenView } from "@/lib/ui-editor/runtime/app/BootScreenView";
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
 * What it looks like, and the two decisions behind that, belong to `BootScreenView`, which a Dev
 * Mode window draws too. This is the packaged game's half: it follows the boot progress store and
 * lifts at the first frame. The colour it is handed is the one the shell already gave its window for
 * this game (see `bootAppearance`), so the wait is the colour the title screen arrives in.
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
     * The indicator's colour: ink that reads against `background`, which is the only property this
     * mark has to have. See `resolveRuntimeBootColors`.
     */
    accent: string;
}): ReactNode {
    const progress = useSyncExternalStore(subscribeRuntimeBootProgress, getRuntimeBootProgress);
    if (progress.phase === "firstFrame") {
        return null;
    }
    return (
        <BootScreenView
            background={background}
            accent={accent}
            lang={getShellLocale()}
            progress={{ loaded: progress.loaded, total: progress.total }}
            placement="window"
        />
    );
}
