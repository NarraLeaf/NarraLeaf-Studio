import { createRoot } from "react-dom/client";
import "@/styles/styles.css";
import { GameRuntimeApp } from "./GameRuntimeApp";
import { RuntimeCrashBoundary } from "./RuntimeCrashBoundary";
import { installRuntimeErrorHooks } from "./runtimeErrorHooks";

// Before anything that can throw, including the missing-root check below: a game that dies while
// booting is precisely the case that has to be told about, and a hook installed after React would
// miss it.
installRuntimeErrorHooks();

const root = document.getElementById("root");

if (!root) {
    throw new Error("Runtime root element not found");
}

// Around everything, including the pack read: a game that cannot start and a game that stops
// drawing halfway through look the same to the player, and both used to end as a black window.
createRoot(root).render(
    <RuntimeCrashBoundary>
        <GameRuntimeApp />
    </RuntimeCrashBoundary>,
);
