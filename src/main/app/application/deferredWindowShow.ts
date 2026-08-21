/**
 * A window that was built without being put on screen, and the two things that have to happen
 * before it is.
 *
 * Studio builds the launcher for every launch, including the ones that are going straight into a
 * project: the project is opened *from* the home screen, which is what gives a startup the whole of
 * the home screen's failure behaviour. Showing it on the way there is the part nobody asked for -
 * the author watches their home screen appear and disappear before the workspace arrives.
 *
 * So the window is held back, and shown only if the launch turns out not to land anywhere else.
 * Which of the two - the window becoming ready, and somebody changing their mind about hiding it -
 * happens first is not knowable: the renderer announces ready on its own schedule, and the project
 * it is being held back for can fail before or after that. `ready` is also not a sticky event, so
 * subscribing to it after the fact would wait for a second one that never comes. Both are therefore
 * latched, and whichever arrives last does the showing.
 */
export interface DeferredWindowShow {
    /** The window finished its first render and is now showable. */
    markReady(): void;
    /** Show it - now, or as soon as it is ready. Repeat calls do nothing. */
    reveal(): void;
    /** Whether {@link reveal} has been asked for. */
    isRevealed(): boolean;
}

export interface DeferredWindowShowHost {
    /** True once the window is gone: there is nothing left to show, and showing it would throw. */
    isClosed(): boolean;
    show(): void;
}

export function createDeferredWindowShow(host: DeferredWindowShowHost): DeferredWindowShow {
    let ready = false;
    let revealed = false;
    let shown = false;

    const showIfDue = () => {
        if (!ready || !revealed || shown || host.isClosed()) {
            return;
        }
        shown = true;
        host.show();
    };

    return {
        markReady: () => {
            ready = true;
            showIfDue();
        },
        reveal: () => {
            revealed = true;
            showIfDue();
        },
        isRevealed: () => revealed,
    };
}
