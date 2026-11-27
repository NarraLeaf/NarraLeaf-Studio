/** A bare "something moved" signal: the selection frame's render events, passed to what follows them. */
export type FrameSignal = {
    notify: () => void;
    subscribe: (listener: () => void) => () => void;
};

export function createFrameSignal(): FrameSignal {
    const listeners = new Set<() => void>();
    return {
        notify: () => {
            for (const listener of listeners) {
                listener();
            }
        },
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
