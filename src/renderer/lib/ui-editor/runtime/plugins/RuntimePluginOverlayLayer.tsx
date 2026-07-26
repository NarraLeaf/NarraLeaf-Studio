/**
 * Host-rendered overlay layer for runtime plugins (`ui.overlay`).
 *
 * Plugins hand the host a render function and the host mounts its result — the
 * game environment withholds `react-dom/client` on purpose, so a plugin cannot
 * create a second React root that would fight the host's over the same tree.
 *
 * The store lives outside React because plugin `setup()` runs before the game
 * app mounts: a plugin may call `mount()` at load time and the layer picks it up
 * when it renders. A plugin whose render throws is dropped from the layer rather
 * than taking the game down with it.
 *
 * ## Where this sits, and why the z-index is what it is
 *
 * GameApp renders this layer at `zIndex: 5` — above the NarraLeaf stage (`z-0`)
 * and below the app surface system (`z-10`: menus, save screens, every authored
 * page). That number is a conclusion, not a guess, so do not "tidy" it: it is
 * the only band between those two, and the two neighbours are what define it.
 *
 * It is also **above the dialogue box**, which is not where anyone would want
 * it. That part is not fixable from here. The engine renders say/NVL inside its
 * `Player`, and the only injection point a host has into that tree is `Player`'s
 * children — emitted *after* the dialogue, so anything mounted there stacks
 * above it too. There is no DOM position beneath the dialogue for a host layer
 * to take. Lowering it needs an overlay slot on the engine side; until then an
 * overlay drawn where dialogue happens will cover it.
 *
 * Must stay under `@/lib/ui-editor/` so the standalone game runtime bundle can
 * include it (see project/build/build-runtime.js allowedPrefixes).
 */

import {
    Component,
    useSyncExternalStore,
    type ErrorInfo,
    type ReactElement,
    type ReactNode,
} from "react";
import type { RuntimePluginHostUnsubscribe } from "./runtimePluginHost";

type RuntimePluginOverlayEntry = {
    key: string;
    ownerPluginId: string;
    render: () => ReactElement | null;
};

export type RuntimePluginOverlayLogger = (
    level: "info" | "warning" | "error",
    message: string,
) => void;

/**
 * Mounted plugin overlays, newest last. A plain external store: `mount()` is
 * callable before (and after) the React tree that renders it exists.
 */
export class RuntimePluginOverlayStore {
    private entries: readonly RuntimePluginOverlayEntry[] = [];
    private readonly listeners = new Set<() => void>();
    private nextKey = 1;

    public mount(ownerPluginId: string, render: () => ReactElement | null): RuntimePluginHostUnsubscribe {
        if (typeof render !== "function") {
            throw new Error("Runtime plugin overlay requires a render function");
        }
        const entry: RuntimePluginOverlayEntry = {
            key: `${ownerPluginId}#${this.nextKey++}`,
            ownerPluginId,
            render,
        };
        this.entries = [...this.entries, entry];
        this.notify();
        return () => {
            if (!this.entries.includes(entry)) {
                return;
            }
            this.entries = this.entries.filter(item => item !== entry);
            this.notify();
        };
    }

    /** Drop one overlay after its render failed; keeps every other plugin's overlay alive. */
    public evict(key: string): void {
        const next = this.entries.filter(entry => entry.key !== key);
        if (next.length === this.entries.length) {
            return;
        }
        this.entries = next;
        this.notify();
    }

    public getSnapshot = (): readonly RuntimePluginOverlayEntry[] => this.entries;

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}

type OverlayBoundaryProps = {
    ownerPluginId: string;
    onError: (error: unknown) => void;
    children: ReactNode;
};

/**
 * One boundary per overlay: a plugin that throws while rendering loses its own
 * overlay and nothing else. React needs a class for this — there is no hook
 * equivalent of componentDidCatch.
 */
class RuntimePluginOverlayBoundary extends Component<OverlayBoundaryProps, { failed: boolean }> {
    public constructor(props: OverlayBoundaryProps) {
        super(props);
        this.state = { failed: false };
    }

    public static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    public componentDidCatch(error: Error, _info: ErrorInfo): void {
        this.props.onError(error);
    }

    public render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Renders every mounted plugin overlay. The wrapper itself takes no pointer
 * events; an overlay that wants them re-enables them on its own elements, so a
 * decorative overlay never swallows clicks meant for the game.
 */
export function RuntimePluginOverlayLayer(props: {
    store: RuntimePluginOverlayStore;
    log?: RuntimePluginOverlayLogger;
}): ReactElement | null {
    const { store, log } = props;
    const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    if (entries.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0" data-nls-plugin-overlays="">
            {entries.map(entry => {
                let content: ReactElement | null = null;
                try {
                    content = entry.render();
                } catch (error) {
                    log?.("error", `[plugin:${entry.ownerPluginId}] overlay render failed: ${describeError(error)}`);
                    // Synchronous throws cannot reach the boundary below (they
                    // happen in *our* render), so drop the overlay here.
                    queueMicrotask(() => store.evict(entry.key));
                    return null;
                }
                return (
                    <RuntimePluginOverlayBoundary
                        key={entry.key}
                        ownerPluginId={entry.ownerPluginId}
                        onError={error => {
                            log?.("error", `[plugin:${entry.ownerPluginId}] overlay crashed: ${describeError(error)}`);
                            store.evict(entry.key);
                        }}
                    >
                        {content}
                    </RuntimePluginOverlayBoundary>
                );
            })}
        </div>
    );
}
