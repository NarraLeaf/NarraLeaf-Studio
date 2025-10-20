import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { WindowVisibilityStatus } from "@shared/types/window";

/**
 * Manage window control actions and window state.
 * Encapsulates preloaded interface calls and exposes simple helpers.
 */
export function useWindowControls() {
    const [status, setStatus] = useState<WindowVisibilityStatus>("normal");

    const refreshStatus = useCallback(async () => {
        const res = await getInterface().window.control.status();
        if (res.success) {
            setStatus(res.data.status);
        } else {
            // Keep last known status on failure
            console.error("[useWindowControls] Failed to get status", res.error);
        }
    }, []);

    const minimize = useCallback(async () => {
        await getInterface().window.control.minimize();
        await refreshStatus();
    }, [refreshStatus]);

    const toggleMaximize = useCallback(async () => {
        const res = await getInterface().window.control.status();
        if (!res.success) {
            console.error("[useWindowControls] Failed to get status", res.error);
            return;
        }
        if (res.data.status === "maximized") {
            await getInterface().window.control.unmaximize();
        } else {
            await getInterface().window.control.maximize();    
        }
        await refreshStatus();
    }, [refreshStatus]);

    const close = useCallback(async () => {
        await getInterface().window.control.close();
    }, []);

    useEffect(() => {
        // Initialize status on mount
        refreshStatus();
    }, [refreshStatus]);

    return {
        isMaximized: status === "maximized",
        status,
        refreshStatus,
        minimize,
        toggleMaximize,
        close,
    };
}


