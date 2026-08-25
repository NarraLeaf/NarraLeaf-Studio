import { createRoot } from "react-dom/client";
import "@/styles/styles.css";
import {
    readGameRuntimeIndexUrl,
    withoutGameRuntimeCrashDetails,
} from "@shared/utils/gameRuntimeIndexUrl";
import { GameRuntimeApp } from "./GameRuntimeApp";
import { RuntimeCrashBoundary } from "./RuntimeCrashBoundary";
import { RuntimeCrashScreen } from "./RuntimeCrashScreen";
import { setRuntimeCrashPolicy, setRuntimeShellLogPath } from "./crashPolicy";
import { installRuntimeErrorHooks } from "./runtimeErrorHooks";
import { installScrollbarAutoHide } from "@/styles/scrollbarAutoHide";
import { getActiveProjectLocale, subscribeActiveProjectLocale } from "@shared/typography/projectFonts";
import { installDocumentLanguage } from "./documentLanguage";

// Before anything else, including the missing-root check below: what this build does about a crash
// has to be settled before there is any chance of one, and read from the page's own address rather
// than from the bridge. The address is there whether or not the preload ran - and a preload that
// never ran is precisely a case the crash screen has to be right in. The web export states
// nothing, which leaves the default until the pack lands.
const shell = readGameRuntimeIndexUrl(window.location.search);
setRuntimeCrashPolicy(shell.policy);
setRuntimeShellLogPath(shell.logPath);

// Ahead of React, so a throw during boot is observed too - that is the window in which a broken
// pack most often dies.
installRuntimeErrorHooks();

// The JS half of the scrollbar rules in styles.css, which this runtime shares with Studio: without
// it no scroller the game draws - a saves list, a long log - ever shows a thumb.
installScrollbarAutoHide();

// `<html lang>` follows the language the game is being read in, which the entry document can only
// state as the language it was written in. The browser picks the fallback font's Han forms and its
// line breaking from it. See `documentLanguage`.
installDocumentLanguage({
    getLanguage: getActiveProjectLocale,
    subscribe: subscribeActiveProjectLocale,
    apply: language => {
        document.documentElement.lang = language;
    },
});

const root = document.getElementById("root");

if (!root) {
    throw new Error("Runtime root element not found");
}

/**
 * The main process replacing a page whose process died (see `recoverDeadRenderer`).
 *
 * Nothing in the old page survived to be caught, so this is not a recovery of the game: the game
 * does not boot at all here. Drawing the crash screen and stopping is the honest thing - the state
 * the player was in went with the process, and pretending otherwise would mean starting a session
 * that quietly lost its place.
 */
const crashDetails = shell.crashDetails;

createRoot(root).render(
    crashDetails === null
        ? (
            // Around everything, including the pack read: a game that cannot start and a game that
            // stops drawing halfway through look the same to the player, and both used to end as a
            // black window.
            <RuntimeCrashBoundary>
                <GameRuntimeApp />
            </RuntimeCrashBoundary>
        )
        // Restarting has to drop the marker, or the reload lands right back on this screen.
        // Only the failure is dropped. Clearing the whole query would take the policy and the log
        // path with it, leaving a restarted game knowing less about itself than the crashed one.
        : (
            <RuntimeCrashScreen
                details={crashDetails}
                onRestart={() => { window.location.search = withoutGameRuntimeCrashDetails(window.location.search); }}
            />
        ),
);
