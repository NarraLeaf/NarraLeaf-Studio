import { useEffect, useCallback, useState, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { PropertyEditorRegistration, PropertyEditorSchema, SelectionType } from "./types";

/**
 * Registry for property editor schemas
 */
class PropertyEditorRegistry {
    private registrations: PropertyEditorRegistration<any>[] = [];
    private listeners: Set<() => void> = new Set();

    /**
     * Register a property editor schema
     */
    register<TData>(registration: PropertyEditorRegistration<TData>): () => void {
        this.registrations.push(registration);
        this.notifyListeners();

        return () => {
            const index = this.registrations.indexOf(registration);
            if (index >= 0) {
                this.registrations.splice(index, 1);
                this.notifyListeners();
            }
        };
    }

    /**
     * Find the best matching editor for a selection
     */
    findEditor<TData>(selection: SelectionState): PropertyEditorSchema<TData> | null {
        if (!selection.type || !selection.data) {
            return null;
        }

        // Filter registrations by selection type
        const matching = this.registrations.filter(
            (reg) => reg.selectionType === selection.type
        );

        // Further filter by predicate if provided
        const applicable = matching.filter((reg) => {
            if (reg.when) {
                return reg.when(selection.data);
            }
            return true;
        });

        // Sort by priority (higher first) and return the best match
        applicable.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        return applicable.length > 0 ? applicable[0].schema : null;
    }

    /**
     * Get all registrations
     */
    getAll(): PropertyEditorRegistration<any>[] {
        return [...this.registrations];
    }

    /**
     * Subscribe to registry changes
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners() {
        this.listeners.forEach((listener) => listener());
    }
}

// Global registry instance
const globalRegistry = new PropertyEditorRegistry();

/**
 * Get the global property editor registry
 */
export function getPropertyEditorRegistry(): PropertyEditorRegistry {
    return globalRegistry;
}

/**
 * Hook to register a property editor schema
 * Returns an unregister function
 */
export function useRegisterPropertyEditor<TData>(
    registration: PropertyEditorRegistration<TData>,
    deps: any[] = []
): void {
    useEffect(() => {
        const unregister = globalRegistry.register(registration);
        return unregister;
    }, deps);
}

/**
 * Result of usePropertyEditor hook
 */
interface UsePropertyEditorResult<TData = any> {
    /** The current selection data */
    data: TData | null;
    /** The selection type */
    selectionType: SelectionType;
    /** The matching editor schema */
    schema: PropertyEditorSchema<TData> | null;
    /** Whether there is an active selection */
    hasSelection: boolean;
    /** Set selection programmatically */
    setSelection: (type: SelectionType, data: any) => void;
    /** Clear the current selection */
    clearSelection: () => void;
    /** Show the properties panel */
    showPanel: () => void;
    /** Hide the properties panel */
    hidePanel: () => void;
}

/**
 * Hook to access and manage property editor state
 */
export function usePropertyEditor<TData = any>(): UsePropertyEditorResult<TData> {
    const { context, isInitialized } = useWorkspace();
    const [selection, setSelectionState] = useState<SelectionState>({
        type: null,
        data: null,
    });
    const [registryVersion, setRegistryVersion] = useState(0);

    // Subscribe to selection changes
    useEffect(() => {
        if (!context || !isInitialized) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

        // Initial state
        setSelectionState(store.getSelection());

        // Subscribe to changes
        const unsub = uiService.getEvents().on("selectionChanged", (sel) => {
            setSelectionState(sel);
        });

        return unsub;
    }, [context, isInitialized]);

    // Subscribe to registry changes
    useEffect(() => {
        const unsub = globalRegistry.subscribe(() => {
            setRegistryVersion((v) => v + 1);
        });
        return unsub;
    }, []);

    // Find matching schema
    const schema = useMemo(() => {
        return globalRegistry.findEditor<TData>(selection);
    }, [selection, registryVersion]);

    const setSelection = useCallback(
        (type: SelectionType, data: any) => {
            if (!context || !isInitialized) return;
            const uiService = context.services.get<UIService>(Services.UI);
            uiService.getStore().setSelection({ type, data });
        },
        [context, isInitialized]
    );

    const clearSelection = useCallback(() => {
        if (!context || !isInitialized) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: null, data: null });
    }, [context, isInitialized]);

    const showPanel = useCallback(() => {
        if (!context || !isInitialized) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.panels.show("narraleaf-studio:properties");
    }, [context, isInitialized]);

    const hidePanel = useCallback(() => {
        if (!context || !isInitialized) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.panels.hide("narraleaf-studio:properties");
    }, [context, isInitialized]);

    return {
        data: selection.data as TData | null,
        selectionType: selection.type as SelectionType,
        schema,
        hasSelection: selection.type !== null && selection.data !== null,
        setSelection,
        clearSelection,
        showPanel,
        hidePanel,
    };
}

/**
 * Helper hook to focus an item and open the properties panel
 */
export function useFocusProperty() {
    const { context, isInitialized } = useWorkspace();

    const focus = useCallback(
        (type: SelectionType, data: any) => {
            if (!context || !isInitialized) return;
            const uiService = context.services.get<UIService>(Services.UI);
            uiService.getStore().setSelection({ type, data });
            uiService.panels.show("narraleaf-studio:properties");
        },
        [context, isInitialized]
    );

    const unfocus = useCallback(() => {
        if (!context || !isInitialized) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: null, data: null });
    }, [context, isInitialized]);

    return { focus, unfocus };
}

