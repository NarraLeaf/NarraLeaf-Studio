
import type { ExperimentalState } from "./experimental";

export type AppEventToken = {
    cancel: () => void;
};

export interface AppInfo {
    version: string;
    /**
     * What experimental mode is doing this run, resolved by the main process. Every window reads it
     * once at startup, which is why it travels here rather than through a request of its own.
     */
    experimental: ExperimentalState;
}
