import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PluginCatalogTask } from "@/lib/plugins/ui/usePluginCatalog";

/**
 * One line for whatever the panel is doing or has just done - the same slot for a success, a
 * failure, and work in progress, so nothing below it moves twice.
 *
 * Rendered by the list AND by the plugin page, because the page is an overlay across the whole
 * panel: a single strip up top would be underneath it, and the actions most likely to fail
 * (authorize, uninstall, reload) are the page's own.
 */
export function PluginTaskLine({ task }: { task: PluginCatalogTask }) {
    if (task.status === "idle" || !task.message) {
        return null;
    }
    return (
        <div className={cn(
            "flex shrink-0 items-start gap-1.5 border-b border-edge-subtle px-3 py-1.5 text-2xs",
            task.status === "error" ? "text-danger" : task.status === "working" ? "text-fg-muted" : "text-success",
        )}>
            {task.status === "error"
                ? <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                : task.status === "working"
                    ? <RefreshCw className="mt-px h-3 w-3 shrink-0 animate-spin" />
                    : <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />}
            <span className="min-w-0 flex-1">{task.message}</span>
        </div>
    );
}
