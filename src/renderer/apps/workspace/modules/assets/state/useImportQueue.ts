import { useCallback, useMemo, useState } from "react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { ImportProgress } from "@/lib/workspace/services/assets/mgr/LocalAssetsManager";

export interface ImportQueueFailure {
    path: string;
    error?: string;
}

/** What the last (or current) import run is doing, and what it left behind. */
export interface ImportQueueState {
    /** The run in flight or most recently finished; null before the first import. */
    run: { type: AssetType; groupId?: string; total: number } | null;
    completed: number;
    /** File being read right now, absent when idle. */
    current?: string;
    running: boolean;
    /** Files that did not make it, kept so they can be retried rather than re-picked. */
    failures: ImportQueueFailure[];
}

export interface ImportQueueController {
    start(run: { type: AssetType; groupId?: string; total: number }): void;
    progress(progress: ImportProgress): void;
    finish(failures: ImportQueueFailure[]): void;
}

const IDLE: ImportQueueState = { run: null, completed: 0, running: false, failures: [] };

/**
 * The state behind the asset panel's import strip: how far a multi-file import has got, and which
 * files failed.
 *
 * Imports used to report as a single boolean spinner plus, afterwards, one alert naming at most
 * three of the failures — which is both unreadable during a 20-file drop and unactionable after it,
 * since re-importing meant finding those files in the picker again. The failures are kept here so a
 * retry can hand the same paths back to the importer.
 */
export function useImportQueue() {
    const [importState, setImportState] = useState<ImportQueueState>(IDLE);

    const importQueue = useMemo<ImportQueueController>(() => ({
        start: run => setImportState({ run, completed: 0, current: undefined, running: true, failures: [] }),
        progress: progress => setImportState(previous => ({
            ...previous,
            completed: progress.completed,
            current: progress.current,
        })),
        finish: failures => setImportState(previous => ({
            ...previous,
            running: false,
            current: undefined,
            failures,
        })),
    }), []);

    const dismissImportFailures = useCallback(() => {
        setImportState(previous => (previous.running ? { ...previous, failures: [] } : IDLE));
    }, []);

    return { importQueue, importState, dismissImportFailures };
}
