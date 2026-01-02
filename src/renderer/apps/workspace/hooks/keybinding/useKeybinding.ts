import { useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusContext, Keybinding } from "@/lib/workspace/services/ui/types";
import { KeybindingCondition } from "./conditions";

/**
 * Options for useKeybinding hook
 */
export interface UseKeybindingOptions {
    /** Unique identifier for this keybinding */
    id: string;
    /** Key combination (e.g., "ctrl+s", "cmd+shift+p", "f2") */
    key: string;
    /** Handler function called when the keybinding is triggered */
    handler: (context: FocusContext) => void | Promise<void>;
    /** Optional description for the keybinding */
    description?: string;
    /** Condition when the keybinding should be active */
    when?: KeybindingCondition;
    /** Whether the keybinding is enabled. Defaults to true. */
    enabled?: boolean;
    /** Dependencies array - keybinding will be re-registered when these change */
    deps?: React.DependencyList;
}

/**
 * Hook to register a single keybinding with automatic lifecycle management
 * 
 * The keybinding is registered when the component mounts and automatically
 * unregistered when the component unmounts.
 * 
 * @example
 * // Simple keybinding
 * useKeybinding({
 *   id: "save",
 *   key: "ctrl+s",
 *   handler: () => saveDocument(),
 *   description: "Save document"
 * });
 * 
 * @example
 * // Keybinding with condition
 * useKeybinding({
 *   id: "copy",
 *   key: "ctrl+c",
 *   handler: handleCopy,
 *   when: whenFocused(FocusArea.LeftPanel, panelId),
 *   description: "Copy selection"
 * });
 * 
 * @example
 * // Keybinding with dynamic enable/disable
 * useKeybinding({
 *   id: "delete",
 *   key: "delete",
 *   handler: deleteItem,
 *   enabled: hasSelection,
 *   when: whenFocused(FocusArea.Editor)
 * });
 */
export function useKeybinding(options: UseKeybindingOptions): void {
    const { context } = useWorkspace();
    const {
        id,
        key,
        handler,
        description,
        when,
        enabled = true,
        deps = [],
    } = options;

    // Use ref to store the latest handler to avoid re-registering on every render
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    // Use ref for the condition as well
    const whenRef = useRef(when);
    whenRef.current = when;

    // Stable handler wrapper
    const stableHandler = useCallback((ctx: FocusContext) => {
        return handlerRef.current(ctx);
    }, []);

    // Stable when wrapper
    const stableWhen = useMemo(() => {
        if (!when) return undefined;
        return (ctx: FocusContext) => {
            const currentWhen = whenRef.current;
            return currentWhen ? currentWhen(ctx) : true;
        };
    }, [when !== undefined]); // Only recreate if when presence changes

    useEffect(() => {
        if (!context || !enabled) return;

        const uiService = context.services.get<UIService>(Services.UI);

        const keybinding: Keybinding = {
            id,
            key,
            description,
            handler: stableHandler,
            when: stableWhen,
        };

        const dispose = uiService.keybindings.register(keybinding);

        return () => {
            dispose();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context, id, key, description, enabled, stableHandler, stableWhen, ...deps]);
}

/**
 * Simplified keybinding definition for batch registration
 */
export interface KeybindingDefinition {
    /** Unique identifier for this keybinding */
    id: string;
    /** Key combination (e.g., "ctrl+s", "cmd+shift+p", "f2") */
    key: string;
    /** Handler function called when the keybinding is triggered */
    handler: (context: FocusContext) => void | Promise<void>;
    /** Optional description for the keybinding */
    description?: string;
    /** Condition when the keybinding should be active */
    when?: KeybindingCondition;
}

/**
 * Options for useKeybindings hook
 */
export interface UseKeybindingsOptions {
    /** Array of keybinding definitions */
    keybindings: KeybindingDefinition[];
    /** Whether all keybindings are enabled. Defaults to true. */
    enabled?: boolean;
    /** Common condition applied to all keybindings (combined with individual when) */
    when?: KeybindingCondition;
    /** Prefix added to all keybinding IDs */
    idPrefix?: string;
    /** Dependencies array - keybindings will be re-registered when these change */
    deps?: React.DependencyList;
}

/**
 * Hook to register multiple keybindings with automatic lifecycle management
 * 
 * All keybindings are registered when the component mounts and automatically
 * unregistered when the component unmounts.
 * 
 * @example
 * // Multiple keybindings with common condition
 * useKeybindings({
 *   keybindings: [
 *     { id: "copy", key: "ctrl+c", handler: handleCopy },
 *     { id: "cut", key: "ctrl+x", handler: handleCut },
 *     { id: "paste", key: "ctrl+v", handler: handlePaste },
 *   ],
 *   when: whenFocused(FocusArea.LeftPanel, panelId),
 *   idPrefix: "assets-panel"
 * });
 * 
 * @example
 * // Conditionally enabled keybindings
 * useKeybindings({
 *   keybindings: clipboardBindings,
 *   enabled: isInitialized && hasPermission,
 *   when: whenFocused(FocusArea.Editor)
 * });
 */
export function useKeybindings(options: UseKeybindingsOptions): void {
    const { context } = useWorkspace();
    const {
        keybindings,
        enabled = true,
        when: commonWhen,
        idPrefix,
        deps = [],
    } = options;

    // Store refs for handlers and conditions
    const handlersRef = useRef<Map<string, (ctx: FocusContext) => void | Promise<void>>>(new Map());
    const whensRef = useRef<Map<string, KeybindingCondition | undefined>>(new Map());
    const commonWhenRef = useRef(commonWhen);

    // Update refs on each render
    keybindings.forEach((kb) => {
        handlersRef.current.set(kb.id, kb.handler);
        whensRef.current.set(kb.id, kb.when);
    });
    commonWhenRef.current = commonWhen;

    // Create stable keybinding signatures for dependency tracking
    const keybindingSignature = useMemo(() => {
        return keybindings.map((kb) => `${kb.id}:${kb.key}`).join("|");
    }, [keybindings]);

    useEffect(() => {
        if (!context || !enabled) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const disposers: Array<() => void> = [];

        keybindings.forEach((kb) => {
            const fullId = idPrefix ? `${idPrefix}-${kb.id}` : kb.id;

            const handler = (ctx: FocusContext) => {
                const currentHandler = handlersRef.current.get(kb.id);
                if (currentHandler) {
                    return currentHandler(ctx);
                }
            };

            const when = (ctx: FocusContext) => {
                const currentCommonWhen = commonWhenRef.current;
                const currentWhen = whensRef.current.get(kb.id);

                // Check common condition first
                if (currentCommonWhen && !currentCommonWhen(ctx)) {
                    return false;
                }
                // Then check individual condition
                if (currentWhen && !currentWhen(ctx)) {
                    return false;
                }
                return true;
            };

            const keybinding: Keybinding = {
                id: fullId,
                key: kb.key,
                description: kb.description,
                handler,
                when: commonWhen || kb.when ? when : undefined,
            };

            const dispose = uiService.keybindings.register(keybinding);
            disposers.push(dispose);
        });

        return () => {
            disposers.forEach((dispose) => dispose());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context, enabled, keybindingSignature, idPrefix, ...deps]);
}

/**
 * Hook that returns keybinding registration utilities
 * Provides manual control over keybinding registration and unregistration
 * 
 * @returns Object with register and unregister functions
 * 
 * @example
 * const { register, unregister } = useKeybindingRegistry();
 * 
 * // Register dynamically
 * useEffect(() => {
 *   const dispose = register({
 *     id: "dynamic",
 *     key: "ctrl+d",
 *     handler: () => console.log("Dynamic keybinding")
 *   });
 *   return dispose;
 * }, [someCondition]);
 */
export function useKeybindingRegistry() {
    const { context } = useWorkspace();

    const register = useCallback(
        (keybinding: KeybindingDefinition): (() => void) => {
            if (!context) {
                console.warn("useKeybindingRegistry: context not available");
                return () => {};
            }

            const uiService = context.services.get<UIService>(Services.UI);
            return uiService.keybindings.register({
                id: keybinding.id,
                key: keybinding.key,
                description: keybinding.description,
                handler: keybinding.handler,
                when: keybinding.when,
            });
        },
        [context]
    );

    const unregister = useCallback(
        (id: string): void => {
            if (!context) {
                console.warn("useKeybindingRegistry: context not available");
                return;
            }

            const uiService = context.services.get<UIService>(Services.UI);
            uiService.keybindings.unregister(id);
        },
        [context]
    );

    const registerMany = useCallback(
        (keybindings: KeybindingDefinition[]): (() => void) => {
            if (!context) {
                console.warn("useKeybindingRegistry: context not available");
                return () => {};
            }

            const uiService = context.services.get<UIService>(Services.UI);
            const disposers = keybindings.map((kb) =>
                uiService.keybindings.register({
                    id: kb.id,
                    key: kb.key,
                    description: kb.description,
                    handler: kb.handler,
                    when: kb.when,
                })
            );

            return () => {
                disposers.forEach((dispose) => dispose());
            };
        },
        [context]
    );

    return {
        register,
        unregister,
        registerMany,
    };
}

