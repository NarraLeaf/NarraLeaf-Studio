import React from "react";
import { AppInfo } from "@shared/types/app";
import { RendererInterfaceKey } from "@shared/types/constants";
import { PlatformInfo } from "@shared/types/os";
import { createRoot } from "react-dom/client";
import { getInterface } from "./app/bridge";
import { CriticalErrorBoundary } from "./app/errorHandling/CriticalErrorBoundary";
import { RenderingStatusAnnouncer } from "./components/announcers/RenderingStatusAnnouncer";

import "@/styles/styles.css";

function validateEnv() {
    if (!window[RendererInterfaceKey]) {
        throw new Error("Invalid environment: Renderer interface not found");
    }
}

let appInfo: AppInfo | null = null;
let platformInfo: PlatformInfo | null = null;

export function getAppInfo() {
    if (!appInfo) {
        throw new Error("App info not found");
    }
    return appInfo;
}

export function getPlatformInfo() {
    if (!platformInfo) {
        throw new Error("Platform info not found");
    }
    return platformInfo;
}

async function renderApp(children: React.ReactNode) {
    // Validate environment
    validateEnv();

    // Get platform info
    const platformResult = await getInterface().getPlatform();
    if (!platformResult.success) {
        throw new Error("Failed to get platform info");
    }
    platformInfo = platformResult.data;

    // Get app info
    const appResult = await getInterface().getAppInfo();
    if (!appResult.success) {
        throw new Error("Failed to get app info");
    }
    appInfo = appResult.data;

    console.log("[renderer] platformInfo", platformInfo);
    console.log("[renderer] appInfo", appInfo);

    const root = createRoot(document.getElementById("root")!);
    const content = (<>
        <RenderingStatusAnnouncer />
        <CriticalErrorBoundary platformInfo={platformResult.data}>
            {children as React.ReactElement}
        </CriticalErrorBoundary>
    </>);

    root.render(
        platformInfo.isPackaged ? content : <React.StrictMode>{content}</React.StrictMode>
    );
    return root;
}

export async function render(module: AppComponentModule) {
    const { default: Component } = await module;

    try {
        return await renderApp(<Component />);
    } catch (error: unknown) {
        const api = getInterface();
        const message = error instanceof Error ? `${error.name}\n${error.message}` : String(error);
        api.terminate(message);
    }
}

type AppComponentFunction = React.FunctionComponent;
type AppComponentModule = Promise<{ default: AppComponentFunction }>;
