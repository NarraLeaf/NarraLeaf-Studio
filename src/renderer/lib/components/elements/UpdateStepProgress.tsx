import { formatBytes } from "@shared/utils/formatBytes";
import type { UpdateState } from "@shared/constants/update";
import { Progress, ProgressIndeterminate } from "./Progress";

/**
 * The step of a software update under way, measured on its own: the bytes of the download, then the
 * share of the new version unpacked. Nothing for any other state.
 *
 * Shared by the title bar's update panel and the Settings row, so both measure the same thing the
 * same way. The title bar's ring is the whole update; this bar is the part the status line names.
 */
export function UpdateStepProgress({ state }: { state: UpdateState }) {
    if (state.status === "downloading") {
        const percent = state.totalBytes && state.totalBytes > 0
            ? ((state.transferredBytes ?? 0) / state.totalBytes) * 100
            : null;
        return (
            <div className="flex flex-col gap-1">
                {percent === null
                    ? <ProgressIndeterminate size="sm" />
                    : <Progress size="sm" value={percent} animated={false} />}
                <p className="text-xs text-fg-subtle tabular-nums">
                    {formatBytes(state.transferredBytes ?? 0)}
                    {state.totalBytes ? ` / ${formatBytes(state.totalBytes)}` : ""}
                    {state.bytesPerSecond ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ""}
                </p>
            </div>
        );
    }
    if (state.status === "preparing") {
        const percent = Math.round((state.prepareProgress ?? 0) * 100);
        return (
            <div className="flex flex-col gap-1">
                <Progress size="sm" value={percent} animated={false} />
                <p className="text-xs text-fg-subtle tabular-nums">{percent}%</p>
            </div>
        );
    }
    return null;
}
