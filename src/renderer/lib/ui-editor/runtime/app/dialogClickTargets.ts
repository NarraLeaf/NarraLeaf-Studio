/**
 * The engine dialog boxes a Game UI dialog surface has on the stage, newest last.
 *
 * A Game UI dialog surface draws over the whole stage and takes the player's click itself, so the
 * blueprint behind it answers by asking the host to advance - and the host advances by clicking the
 * engine's own dialog element, the one whose handler settles the line. That element is the only
 * thing standing between a click on the stage and the story moving, so whatever holds it has to be
 * right for the box that is actually live.
 *
 * More than one box is on the stage more often than it looks. A scene parked behind a returnable
 * jump keeps its dialog layer, its box outlives the jump by the layer's replacement grace, and the
 * scene it called has already drawn a box of its own; two concurrent branches that both speak have
 * one each. A single slot can only hold the last write, and the last write in that overlap is the
 * *departing* box clearing itself - which left every click for the rest of the called scene
 * forwarded to an element that advances nothing, with no error anywhere.
 *
 * So membership is by element: a box only ever removes itself, and one that has left the document
 * is dropped whether or not anyone said so. The newest box still on the stage is the one a click
 * goes to, which is what a single slot was reaching for when the writes happened to be in order.
 */
export type DialogClickTargets = {
    /**
     * Take a box that has just been mounted. `null` claims nothing and only drops what has left -
     * it is what React hands a ref on detach, and what a surface says as it unmounts.
     */
    set(target: HTMLElement | null): void;
    /** The newest box still in the document, or null when the stage has none. */
    current(): HTMLElement | null;
    /** Forget every box. For a session ending, where the whole player tree goes at once. */
    clear(): void;
};

export function createDialogClickTargets(): DialogClickTargets {
    let targets: HTMLElement[] = [];

    // Re-claiming a box moves it to the newest position rather than leaving a duplicate behind.
    const prune = (except: HTMLElement | null): void => {
        targets = targets.filter(target => target.isConnected && target !== except);
    };

    return {
        set(target: HTMLElement | null): void {
            prune(target);
            if (target) {
                targets.push(target);
            }
        },
        current(): HTMLElement | null {
            prune(null);
            return targets.length > 0 ? targets[targets.length - 1] : null;
        },
        clear(): void {
            targets = [];
        },
    };
}
