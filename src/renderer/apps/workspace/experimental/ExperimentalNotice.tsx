import React from "react";
import { FlaskConical } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Modal, dialogFooterButtonClass } from "@/lib/components";
import { activeExperimentalConditions, isExperimentalMode } from "@/lib/experimental";

/**
 * What experimental mode says on the way in: which test conditions this launch turned on, and what
 * each of them changes.
 *
 * Once per launch, not once per window - the main process holds the latch, and the claim is made
 * from an effect that runs after the workspace is on screen. A workspace opened later in the same
 * session gets the status bar's warning wash and nothing else.
 *
 * Untranslated, like everything else in the mode.
 */
/**
 * The claim, made at most once per document and remembered.
 *
 * The latch is spent by the request, so the effect below cannot be allowed to send a second one:
 * in development the workspace renders under StrictMode, which mounts every effect twice, and the
 * discarded first pass would take the notice with it. Both passes read this one promise.
 */
let claim: Promise<boolean> | null = null;

function claimNotice(): Promise<boolean> {
    if (!claim) {
        claim = getInterface().claimExperimentalNotice()
            .then(result => result.success && result.data.show)
            .catch(() => false);
    }
    return claim;
}

export function ExperimentalNotice() {
    const [open, setOpen] = React.useState(false);
    const conditions = activeExperimentalConditions();

    React.useEffect(() => {
        if (!isExperimentalMode()) {
            return;
        }
        void claimNotice().then(show => {
            if (show) {
                setOpen(true);
            }
        });
    }, []);

    if (!open) {
        return null;
    }

    return (
        <Modal
            isOpen
            onClose={() => setOpen(false)}
            title="Experimental mode"
            size="sm"
            footer={
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={dialogFooterButtonClass({ variant: "primary" })}
                >
                    Continue
                </button>
            }
        >
            <div className="flex gap-3">
                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 space-y-3 text-sm text-fg-muted">
                    <p>This launch runs test conditions that are not part of the product.</p>
                    {conditions.length === 0 ? (
                        <p>No test condition is active.</p>
                    ) : (
                        <ul className="space-y-2">
                            {conditions.map(condition => (
                                <li key={condition.id}>
                                    <span className="text-fg">{condition.id}</span>
                                    <span className="block text-fg-muted">{condition.summary}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Modal>
    );
}
