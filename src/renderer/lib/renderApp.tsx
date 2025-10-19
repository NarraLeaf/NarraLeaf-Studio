import { RendererInterfaceKey } from "@shared/types/constants";
import React from "react";
import { getInterface } from "./app/bridge";
import { CriticalErrorBoundary } from "./app/errorHandling/CriticalErrorBoundary";
import { createRoot } from "react-dom/client";

function validateEnv() {
    if (!window[RendererInterfaceKey]) {
        throw new Error("Invalid environment: Renderer interface not found");
    }
}

export async function renderApp(children: React.ReactNode) {
    // Validate environment
    validateEnv();

    // Get platform info
    const platformInfo = await getInterface().getPlatform();
    if (!platformInfo.success) {
        throw new Error("Failed to get platform info");
    }

    console.log("[renderer] platformInfo", platformInfo.data);

    const root = createRoot(document.getElementById("root")!);
    root.render(
        <React.StrictMode>
            <CriticalErrorBoundary platformInfo={platformInfo.data}>
                {children as React.ReactElement}
            </CriticalErrorBoundary>
        </React.StrictMode>
    );
    return root;
}

export function renderAppAsync(children: React.ReactNode) {
    return (async () => {
        return await renderApp(children);
    })();
}

