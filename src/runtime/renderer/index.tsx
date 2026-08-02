import { createRoot } from "react-dom/client";
import "@/styles/styles.css";
import { GameRuntimeApp } from "./GameRuntimeApp";
import { installRuntimeTestErrorHooks } from "./testErrorHooks";

// Before anything that can throw, including the missing-root check below: a game that dies while
// booting is precisely the case a test needs told about, and a hook installed after React would
// miss it.
installRuntimeTestErrorHooks();

const root = document.getElementById("root");

if (!root) {
    throw new Error("Runtime root element not found");
}

createRoot(root).render(<GameRuntimeApp />);
