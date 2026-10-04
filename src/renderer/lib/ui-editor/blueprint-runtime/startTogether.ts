/**
 * Every listener of one event, started together.
 *
 * Blueprints are event driven, so an event is a broadcast: every head listening for it starts the
 * moment it is raised. They used to run one after another, in node-id order, and a chain that waited
 * - a Delay, an animation, a page transition - held back every chain whose head happened to sort
 * after it. That order was invisible on the canvas, nobody chose it, and in a project made in Studio
 * it was the order of two random ids.
 *
 * Each task is started in the order given, synchronously up to its first wait, so a dispatch with a
 * single listener starts it exactly where it always did. The returned promise settles when every task
 * has: a host that waits for an event to be handled - `On Game Ready` holding the boot, a close
 * request whose answer is read afterwards - waits for all of its listeners. A task that throws or
 * rejects stops none of the others; its outcome comes back in the same position it was given, for the
 * caller to report the way it reports one.
 *
 * Nothing runs in parallel: the listeners share one thread and take turns at their waits. Two of them
 * writing the same variable see each other's writes at those points, which is the price of not making
 * one wait for the other.
 */
export function startTogether<T>(
    tasks: ReadonlyArray<() => T | PromiseLike<T>>,
): Promise<PromiseSettledResult<Awaited<T>>[]> {
    return Promise.allSettled(tasks.map(task => {
        try {
            return task();
        } catch (error) {
            return Promise.reject(error);
        }
    }));
}
