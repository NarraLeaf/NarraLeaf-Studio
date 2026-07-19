import React from "react";
import { MotionConfig } from "motion/react";
import { AppInfo } from "@shared/types/app";
import { PlatformInfo } from "@shared/types/os";
import { createRoot } from "react-dom/client";
import { getInterface, hardenRendererBridge, initializeRendererBridge } from "./app/bridge";
import { CriticalErrorBoundary } from "./app/errorHandling/CriticalErrorBoundary";
import { RenderingStatusAnnouncer } from "./components/announcers/RenderingStatusAnnouncer";
import { initI18n } from "./i18n";
import { initAppearance, isReduceMotionEnabled, subscribeReduceMotion } from "./appearance";
import { initZoom } from "./zoom";

import "@/styles/styles.css";

function validateEnv() {
    initializeRendererBridge();
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

/**
 * The framer-motion half of the reduced-motion preference.
 *
 * The CSS blanket in styles.css cannot reach these animations: framer-motion
 * writes styles frame by frame from JS, so there is no transition or animation
 * for a `transition-duration` override to shorten. `reducedMotion="always"`
 * makes it drop transform and layout animations of its own accord.
 *
 * When the setting is off this hands back framer-motion's own default rather
 * than "user": the OS preference is already honored by `prefers-reduced-motion`
 * in CSS, and letting the library read it too would double up on the parts it
 * animates. Game content re-opts in with its own `MotionConfig` — see
 * `GameApp` and `NlrStageLayer`.
 */
function MotionPreference({ children }: { children: React.ReactNode }) {
    const [reduced, setReduced] = React.useState(isReduceMotionEnabled);
    React.useEffect(() => subscribeReduceMotion(setReduced), []);
    return (
        <MotionConfig reducedMotion={reduced ? "always" : "never"}>
            {children}
        </MotionConfig>
    );
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

    // Load the persisted language + subscribe to live changes before the first
    // paint, so every window renders in the right language with no flash.
    await initI18n();

    // Publishes `--nl-zoom` for the titlebar's traffic-light safe area.
    await initZoom();

    // Accent color and reduced motion, applied to the root element before the
    // first paint so no window renders a frame in the wrong accent.
    await initAppearance();

    console.log("[renderer] platformInfo", platformInfo);
    console.log("[renderer] appInfo", appInfo);

    hardenRendererBridge();

    const root = createRoot(document.getElementById("root")!);
    const content = (<>
        <RenderingStatusAnnouncer />
        <CriticalErrorBoundary platformInfo={platformResult.data}>
            <MotionPreference>
                {children as React.ReactElement}
            </MotionPreference>
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
