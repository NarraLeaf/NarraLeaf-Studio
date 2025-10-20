import { RendererInterfaceKey } from "@shared/types/constants";
import React, { useEffect, useRef } from "react";
import { getInterface } from "./app/bridge";
import { CriticalErrorBoundary } from "./app/errorHandling/CriticalErrorBoundary";
import { createRoot } from "react-dom/client";
import "@/styles/styles.css";
import { AppInfo } from "@shared/types/app";
import { PlatformInfo } from "@shared/types/os";

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

export async function renderApp(children: React.ReactNode) {
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
    const content = (
        <CriticalErrorBoundary platformInfo={platformResult.data}>
            <RenderingStatusAnnouncer />
            {children as React.ReactElement}
        </CriticalErrorBoundary>
    );

    root.render(
        platformInfo.isPackaged ? content : <React.StrictMode>{content}</React.StrictMode>
    );
    return root;
}

export function renderAppAsync(children: React.ReactNode) {
    return (async () => {
        return await renderApp(children);
    })();
}

function RenderingStatusAnnouncer() {
    const emitted = useRef(false);

    useEffect(() => {
        if (emitted.current) {
            return;
        }
        emitted.current = true;
        getInterface().window.ready();
    }, []);

    return <></>;
}

