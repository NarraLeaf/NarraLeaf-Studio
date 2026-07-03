import { createRoot } from "react-dom/client";
import "@/styles/styles.css";
import { GameRuntimeApp } from "./GameRuntimeApp";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Runtime root element not found");
}

createRoot(root).render(<GameRuntimeApp />);
