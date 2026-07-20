import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";

/**
 * The user's home directory, or undefined until it arrives.
 *
 * Only the main process knows it, so this is a one-off IPC read rather than something a renderer
 * can work out. Undefined is a usable answer: the path helpers that take it (collapseHomePath)
 * simply leave paths uncollapsed, so a surface renders correctly on the first frame and tightens
 * up when the value lands.
 */
export function useHomeDir(): string | undefined {
    const [homeDir, setHomeDir] = useState<string | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const result = await getInterface().app.getSystemPath("home");
                if (!cancelled && result.success) {
                    setHomeDir(result.data.path);
                }
            } catch (error) {
                console.error("[app] Failed to read the home directory:", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    return homeDir;
}
