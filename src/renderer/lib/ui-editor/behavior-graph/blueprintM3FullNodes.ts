import { behaviorNodeRegistry, type BehaviorNodeDefinition } from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";

function requireHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!api) {
        throw new BlueprintGraphExecutionError("Blueprint host API is not available (open Dev Mode)", ctx.node.id);
    }
    return api;
}

const StateGetNode: BehaviorNodeDefinition = {
    type: "blueprint.state.get",
    displayName: "Get state",
    execute: ctx => {
        const api = requireHostApi(ctx);
        const scope = String(ctx.params.scope ?? "surface").trim();
        const key = String(ctx.params.key ?? "").trim();
        if (!key) {
            throw new BlueprintGraphExecutionError("blueprint.state.get requires params.key", ctx.node.id);
        }
        void api.state.get(scope, key);
        return { nextPort: "next" };
    },
};

const StateSetScopedNode: BehaviorNodeDefinition = {
    type: "blueprint.state.setScoped",
    displayName: "Set state (scoped)",
    execute: ctx => {
        const api = requireHostApi(ctx);
        const scope = String(ctx.params.scope ?? "surface").trim();
        const key = String(ctx.params.key ?? "").trim();
        if (!key) {
            throw new BlueprintGraphExecutionError("blueprint.state.setScoped requires params.key", ctx.node.id);
        }
        api.state.set(scope, key, ctx.params.value);
        return { nextPort: "next" };
    },
};

const NavigationOpenSurfaceNode: BehaviorNodeDefinition = {
    type: "blueprint.navigation.openSurface",
    displayName: "Open surface",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const surfaceId = String(ctx.params.surfaceId ?? "").trim();
        if (!surfaceId) {
            throw new BlueprintGraphExecutionError("blueprint.navigation.openSurface requires params.surfaceId", ctx.node.id);
        }
        await api.navigation.openSurface(surfaceId);
        return { nextPort: "next" };
    },
};

const NavigationCloseLayerNode: BehaviorNodeDefinition = {
    type: "blueprint.navigation.closeLayer",
    displayName: "Close layer",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        await api.navigation.closeLayer();
        return { nextPort: "next" };
    },
};

const WidgetSetVisibleNode: BehaviorNodeDefinition = {
    type: "blueprint.widget.setVisible",
    displayName: "Set widget visible",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const elementId = String(ctx.params.elementId ?? "").trim();
        const visible = Boolean(ctx.params.visible ?? true);
        if (!elementId) {
            throw new BlueprintGraphExecutionError("blueprint.widget.setVisible requires params.elementId", ctx.node.id);
        }
        await api.widget.setVisible(elementId, visible);
        return { nextPort: "next" };
    },
};

const WidgetSetEnabledNode: BehaviorNodeDefinition = {
    type: "blueprint.widget.setEnabled",
    displayName: "Set widget enabled",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const elementId = String(ctx.params.elementId ?? "").trim();
        const enabled = Boolean(ctx.params.enabled ?? true);
        if (!elementId) {
            throw new BlueprintGraphExecutionError("blueprint.widget.setEnabled requires params.elementId", ctx.node.id);
        }
        await api.widget.setEnabled(elementId, enabled);
        return { nextPort: "next" };
    },
};

const PersistenceGetNode: BehaviorNodeDefinition = {
    type: "blueprint.persistence.get",
    displayName: "Persistence get",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const key = String(ctx.params.key ?? "").trim();
        if (!key) {
            throw new BlueprintGraphExecutionError("blueprint.persistence.get requires params.key", ctx.node.id);
        }
        await api.persistence.get(key);
        return { nextPort: "next" };
    },
};

const PersistenceSetNode: BehaviorNodeDefinition = {
    type: "blueprint.persistence.set",
    displayName: "Persistence set",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const key = String(ctx.params.key ?? "").trim();
        if (!key) {
            throw new BlueprintGraphExecutionError("blueprint.persistence.set requires params.key", ctx.node.id);
        }
        await api.persistence.set(key, ctx.params.value);
        return { nextPort: "next" };
    },
};

const MediaPlayAudioNode: BehaviorNodeDefinition = {
    type: "blueprint.media.playAudio",
    displayName: "Play audio",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const assetIdOrUrl = String(ctx.params.assetIdOrUrl ?? ctx.params.url ?? "").trim();
        if (!assetIdOrUrl) {
            throw new BlueprintGraphExecutionError("blueprint.media.playAudio requires params.assetIdOrUrl", ctx.node.id);
        }
        await api.media.playAudio(assetIdOrUrl);
        return { nextPort: "next" };
    },
};

const MediaPlayAnimationNode: BehaviorNodeDefinition = {
    type: "blueprint.media.playAnimation",
    displayName: "Play animation",
    async execute(ctx) {
        const api = requireHostApi(ctx);
        const elementId = String(ctx.params.elementId ?? "").trim();
        const animationId = String(ctx.params.animationId ?? "").trim();
        if (!elementId || !animationId) {
            throw new BlueprintGraphExecutionError(
                "blueprint.media.playAnimation requires params.elementId and params.animationId",
                ctx.node.id,
            );
        }
        await api.media.playAnimation(elementId, animationId);
        return { nextPort: "next" };
    },
};

const DevtoolsLogNode: BehaviorNodeDefinition = {
    type: "blueprint.devtools.log",
    displayName: "Log",
    execute: ctx => {
        const api = requireHostApi(ctx);
        const message = String(ctx.params.message ?? "");
        const level = String(ctx.params.level ?? "info");
        api.devtools.log(level, message);
        return { nextPort: "next" };
    },
};

behaviorNodeRegistry.registerMany([
    StateGetNode,
    StateSetScopedNode,
    NavigationOpenSurfaceNode,
    NavigationCloseLayerNode,
    WidgetSetVisibleNode,
    WidgetSetEnabledNode,
    PersistenceGetNode,
    PersistenceSetNode,
    MediaPlayAudioNode,
    MediaPlayAnimationNode,
    DevtoolsLogNode,
]);
