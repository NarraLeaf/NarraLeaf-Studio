/**
 * What a runtime-drawn character's entrance waits for: her model, loaded.
 *
 * The engine mounts every puppet a scene uses when the scene starts, hidden, and the backend begins
 * loading its model then - the same head start the scene's images get. What nothing waited for was
 * the end of that load. A character who comes on in the scene's first rows, or at a row a launch
 * starts from, faded her empty box in over 300 ms and then appeared all at once when the model
 * arrived, after the fade was over. An image entrance never does this: its picture is in the
 * preload plan's gate.
 *
 * So the entrance row waits, before it starts the fade, until the model has loaded or has failed to.
 * A model that loaded long ago - the usual case for a character who enters later in a scene - costs
 * nothing. A load that never settles is not waited out forever: the entrance goes on after
 * {@link PUPPET_ENTRANCE_WAIT_MS}, as it always did.
 *
 * Under `@/lib/ui-editor/` so the standalone game runtime bundle includes it.
 */

import type { Puppet, PuppetStatus } from "narraleaf-react";

/** The longest an entrance waits for its model before it goes on regardless. */
export const PUPPET_ENTRANCE_WAIT_MS = 5000;

/**
 * How long a box with no instance yet is given to mount one.
 *
 * The element is put on stage at the top of the scene, and the backend is mounted when React
 * commits it, so an entrance on the scene's first row can arrive between the two. A box still
 * without an instance after this is one nothing will mount - a host with no stage - and there is
 * nothing to wait for.
 */
export const PUPPET_UNMOUNTED_GRACE_MS = 250;

/** The statuses that end the wait: the model is drawn, or it never will be. */
const SETTLED: ReadonlySet<PuppetStatus> = new Set<PuppetStatus>(["ready", "error", "missing-backend"]);

export type PuppetStatusSource = Pick<Puppet, "getStatus" | "onStatusChange">;

/** Resolve once `puppet`'s model has loaded or failed, or when the wait is cut short. Never rejects. */
export function waitForPuppetModel(
    puppet: PuppetStatusSource,
    signal: AbortSignal,
    timeoutMs: number = PUPPET_ENTRANCE_WAIT_MS,
): Promise<void> {
    if (signal.aborted || SETTLED.has(puppet.getStatus())) {
        return Promise.resolve();
    }
    return new Promise<void>(resolve => {
        let graceTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
            token.cancel();
            clearTimeout(limitTimer);
            if (graceTimer !== null) {
                clearTimeout(graceTimer);
            }
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const armGrace = (status: PuppetStatus) => {
            if (graceTimer !== null) {
                clearTimeout(graceTimer);
                graceTimer = null;
            }
            if (status === "unmounted") {
                graceTimer = setTimeout(finish, PUPPET_UNMOUNTED_GRACE_MS);
            }
        };
        const token = puppet.onStatusChange(status => {
            if (SETTLED.has(status)) {
                finish();
                return;
            }
            armGrace(status);
        });
        const limitTimer = setTimeout(finish, timeoutMs);
        signal.addEventListener("abort", finish);
        armGrace(puppet.getStatus());
    });
}
