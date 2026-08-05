import React from "react";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { useWorkspace } from "../context";

/**
 * The one strip that says this window is not an ordinary workspace.
 *
 * It has to exist because the window otherwise looks exactly like a workspace now: same title bar,
 * same sidebar, same panels for whatever loaded. An author who forgets which mode they are in will
 * eventually type something and watch it fail to save. Two facts and the way out; everything else
 * about the mode lives in the panel, where there is room to say it properly.
 */
export function RecoveryBanner() {
    const { recovery } = useWorkspace();
    const { t } = useTranslation();
    const [leaving, setLeaving] = React.useState(false);

    if (!recovery) {
        return null;
    }

    const leave = async () => {
        setLeaving(true);
        try {
            await getInterface().workspace.setRecoveryMode(false);
        } finally {
            // The reload normally gets here first; this only matters when it did not, and a button
            // stuck disabled would be the second thing to go wrong in a row.
            setLeaving(false);
        }
    };

    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5">
            <LifeBuoy className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                {t("workspace.recovery.banner.state")}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void leave()} disabled={leaving}>
                {t("workspace.recovery.banner.exit")}
            </Button>
        </div>
    );
}
