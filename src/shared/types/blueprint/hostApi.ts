/** Bumped when BlueprintHostApiContract shape changes incompatibly */
export const BLUEPRINT_HOST_API_CONTRACT_VERSION = 5 as const;

export type BlueprintHostApiContractVersion = typeof BLUEPRINT_HOST_API_CONTRACT_VERSION;

/**
 * Blueprint System — host API contract surface.
 * Visual and TypeScript blueprints share this capability tree; implementations live in runtime (M3+).
 *
 * - purity: whether the operation is side-effect free from the blueprint semantics perspective
 * - callableFromBinding: if false, must not be invoked from field/binding evaluation
 * - async: if true, callers should treat the operation as Promise-capable
 */

export type BlueprintHostApiPurity = "pure" | "effectful";

export type BlueprintHostCapabilityContract = {
    /** Human-readable capability id, stable across frontends */
    capabilityId: string;
    purity: BlueprintHostApiPurity;
    /** Only pure reads/compute may run inside binding evaluation */
    callableFromBinding: boolean;
    async: boolean;
    /** Loose input/output shapes; M3 implementations narrow */
    input?: Record<string, unknown>;
    output?: unknown;
};

export type BlueprintHostApiFamily = Record<string, BlueprintHostCapabilityContract>;

/**
 * Host API families (see blueprint-system-milestones §5.5).
 * Values are capability name -> contract metadata (not runtime functions).
 */
export type BlueprintHostApiContract = {
    navigation: BlueprintHostApiFamily;
    widget: BlueprintHostApiFamily;
    state: BlueprintHostApiFamily;
    persistence: BlueprintHostApiFamily;
    frame: BlueprintHostApiFamily;
    devtools: BlueprintHostApiFamily;
};

/**
 * Canonical M1 capability ids and defaults. Runtime adapters map to these names in M3+.
 */
export const BLUEPRINT_HOST_API_M1_CAPABILITIES: BlueprintHostApiContract = {
    navigation: {
        openSurface: {
            capabilityId: "navigation.openSurface",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { surfaceId: "" },
            output: undefined,
        },
        closeLayer: {
            capabilityId: "navigation.closeLayer",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: {},
            output: undefined,
        },
    },
    widget: {
        setVisible: {
            capabilityId: "widget.setVisible",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { elementId: "", visible: true },
            output: undefined,
        },
        setEnabled: {
            capabilityId: "widget.setEnabled",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { elementId: "", enabled: true },
            output: undefined,
        },
        setVariant: {
            capabilityId: "widget.setVariant",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", variantId: "" },
            output: undefined,
        },
        getTextProperties: {
            capabilityId: "widget.getTextProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setTextProperties: {
            capabilityId: "widget.setTextProperties",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", patch: {} },
            output: undefined,
        },
        getSliderProperties: {
            capabilityId: "widget.getSliderProperties",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { elementId: "" },
            output: {},
        },
        setSliderProperties: {
            capabilityId: "widget.setSliderProperties",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { elementId: "", patch: {} },
            output: undefined,
        },
    },
    state: {
        get: {
            capabilityId: "state.get",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { scope: "", key: "" },
            output: undefined,
        },
        set: {
            capabilityId: "state.set",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { scope: "", key: "", value: undefined },
            output: undefined,
        },
    },
    persistence: {
        get: {
            capabilityId: "persistence.get",
            purity: "pure",
            callableFromBinding: true,
            async: true,
            input: { key: "" },
            output: undefined,
        },
        set: {
            capabilityId: "persistence.set",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { key: "", value: undefined },
            output: undefined,
        },
    },
    frame: {
        getParam: {
            capabilityId: "frame.getParam",
            purity: "pure",
            callableFromBinding: true,
            async: false,
            input: { key: "" },
            output: undefined,
        },
        emit: {
            capabilityId: "frame.emit",
            purity: "effectful",
            callableFromBinding: false,
            async: true,
            input: { event: "", data: undefined },
            output: undefined,
        },
    },
    devtools: {
        log: {
            capabilityId: "devtools.log",
            purity: "effectful",
            callableFromBinding: false,
            async: false,
            input: { level: "info", message: "" },
            output: undefined,
        },
    },
};
