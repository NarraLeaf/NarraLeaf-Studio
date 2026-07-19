import type {
    StoryActionPayload,
    StoryAnimationAsset,
    StoryBlock,
    StoryCharacterVariantSelection,
    StoryConditionRef,
    StoryDocument,
    StoryLayerRef,
    StoryLiteralValue,
    StoryScene,
    StoryTransformRef,
    StoryVariableRef,
} from "@shared/types/story";
import { isStoryExpressionEvaluable, resolveDisplayableTargetRef } from "@shared/types/story";
import { evaluateStoryExpression, isTruthy } from "@shared/utils/storyExpressionEval";
import {
    getCharacterStageObjectName,
    mergeTransformProps,
    normalizeObjectName,
    storyTransformRefFinalProps,
    type VisibilityTransformMode,
} from "./storyTransformProps";

/**
 * Studio-side stage-state computation: walk a scene's blocks in execution order up to (but not
 * including) the target block and accumulate the settled visual state of the stage - background,
 * every displayable's final transform props and visibility, variables, and NVL mode. The preview
 * then renders this snapshot directly (pre-posed elements + the target action), so no runtime
 * fast-forwarding is ever needed.
 *
 * Semantics mirror the NLR story compiler exactly (same object-name keying, preset/animation
 * final-prop math, condition operators); approximations are surfaced as diagnostics.
 */

export type StageSnapshotDiagnostic = {
    level: "warning" | "error";
    blockId?: string;
    message: string;
};

export type StageSnapshotImageSource =
    | { type: "asset"; assetId: string }
    | { type: "color"; color: string }
    | { type: "character"; characterId?: string; formName?: string; variants?: StoryCharacterVariantSelection };

/** Residual instant effects to re-apply on the pre-posed element ("clear" = the clear-op ran last). */
export type StageSnapshotEffects = {
    mask?: { assetId: string } | "clear";
    clip?: { clipPath: string } | "clear";
    filter?: { filter: string } | "clear";
    darkness?: number;
};

export type StageSnapshotDisplayable = {
    kind: "image" | "text" | "layer";
    /** Normalized object name - the compiler's element-registry key. */
    objectName: string;
    /** Block that created this displayable, when known (stable identity for editor lookups). */
    sourceBlockId?: string;
    visible: boolean;
    /** Settled transform props in NLR shape (position/opacity/zoom/scaleX/scaleY/rotation/...). */
    props: Record<string, unknown>;
    effects: StageSnapshotEffects;
    // image
    source?: StageSnapshotImageSource;
    autoFit?: boolean;
    layer?: StoryLayerRef;
    // text
    text?: string;
    fontSize?: number;
    fontColor?: string;
    // layer
    zIndex?: number;
};

export type StoryStageSnapshot = {
    background: { assetId?: string; color?: string } | null;
    /** Displayables in creation order. */
    displayables: StageSnapshotDisplayable[];
    /** Props accumulated against the built-in scene background image. */
    backgroundProps: Record<string, unknown>;
    backgroundEffects: StageSnapshotEffects;
    /** Props accumulated against the built-in layers. */
    builtinLayerProps: { backgroundLayer: Record<string, unknown>; displayableLayer: Record<string, unknown> };
    /** Explicitly-assigned variable values (storage key → value). */
    sceneVariables: Record<string, StoryLiteralValue>;
    savedVariables: Record<string, StoryLiteralValue>;
    /** True when the target sits inside an NVL container. */
    nvl: boolean;
    diagnostics: StageSnapshotDiagnostic[];
};

export function computeStoryStageSnapshot(input: {
    document: StoryDocument;
    sceneId: string;
    targetBlockId: string | null;
    animations?: ReadonlyMap<string, StoryAnimationAsset> | Record<string, StoryAnimationAsset>;
}): StoryStageSnapshot {
    const scene = input.document.scenes[input.sceneId];
    if (!scene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }
    const animations = input.animations instanceof Map
        ? input.animations
        : new Map(Object.entries(input.animations ?? {}));
    const walker = new SnapshotWalker(input.document, scene, input.targetBlockId, animations);
    return walker.run();
}

type VariableStore = {
    /** storageKey → value; seeded with defaults, updated by setVariable. */
    scene: Map<string, StoryLiteralValue | null | undefined>;
    saved: Map<string, StoryLiteralValue | null | undefined>;
};

class SnapshotWalker {
    private readonly pathBlockIds = new Set<string>();
    private readonly displayables = new Map<string, StageSnapshotDisplayable>();
    private readonly order: string[] = [];
    private readonly diagnostics: StageSnapshotDiagnostic[] = [];
    private readonly variables: VariableStore = { scene: new Map(), saved: new Map() };
    private readonly assignedScene: Record<string, StoryLiteralValue> = {};
    private readonly assignedSaved: Record<string, StoryLiteralValue> = {};
    private background: { assetId?: string; color?: string } | null = null;
    private backgroundProps: Record<string, unknown> = {};
    private backgroundEffects: StageSnapshotEffects = {};
    private builtinLayerProps = { backgroundLayer: {} as Record<string, unknown>, displayableLayer: {} as Record<string, unknown> };
    private nvl = false;
    private reachedTarget = false;

    constructor(
        private readonly document: StoryDocument,
        private readonly scene: StoryScene,
        private readonly targetBlockId: string | null,
        private readonly animations: ReadonlyMap<string, StoryAnimationAsset>,
    ) {
        let cursor = targetBlockId ? scene.blocks[targetBlockId] : undefined;
        while (cursor && !this.pathBlockIds.has(cursor.id)) {
            this.pathBlockIds.add(cursor.id);
            cursor = cursor.parentId ? scene.blocks[cursor.parentId] : undefined;
        }
        for (const saved of Object.values(document.savedVariables ?? {})) {
            this.variables.saved.set(saved.storageKey, saved.defaultValue ?? null);
        }
        for (const def of Object.values(scene.sceneVariables ?? {})) {
            this.variables.scene.set(def.storageKey, def.defaultValue ?? null);
        }
    }

    run(): StoryStageSnapshot {
        if (this.targetBlockId === null) {
            // Scene start: nothing has executed yet.
        } else if (!this.pathBlockIds.has(this.targetBlockId)) {
            this.diagnostic(this.targetBlockId, "Preview target block not found; previewing the scene start instead.");
        } else {
            this.visitList(this.scene.rootBlockIds, false);
            if (!this.reachedTarget) {
                this.diagnostic(this.targetBlockId, "Preview target is not reachable from the scene root; previewing the scene end instead.");
            }
        }
        return {
            background: this.background,
            displayables: this.order.map(key => this.displayables.get(key) as StageSnapshotDisplayable),
            backgroundProps: this.backgroundProps,
            backgroundEffects: this.backgroundEffects,
            builtinLayerProps: this.builtinLayerProps,
            sceneVariables: this.assignedScene,
            savedVariables: this.assignedSaved,
            nvl: this.nvl,
            diagnostics: this.diagnostics,
        };
    }

    private visitList(blockIds: readonly string[], insideNvl: boolean): void {
        for (const blockId of blockIds) {
            if (this.reachedTarget) {
                return;
            }
            this.visitBlock(blockId, insideNvl);
        }
    }

    private visitBlock(blockId: string, insideNvl: boolean): void {
        const block = this.scene.blocks[blockId];
        if (!block) {
            return;
        }
        if (block.id === this.targetBlockId) {
            this.reachedTarget = true;
            this.nvl = insideNvl;
            return;
        }

        if (block.kind === "nodeAction") {
            if (block.payload.action === "choice") {
                this.visitChoice(block, insideNvl);
                return;
            }
            if (block.payload.action === "choiceOption") {
                this.visitList(block.childrenIds, insideNvl);
                return;
            }
            // narration / dialogue have no stage-state effect before the target.
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "action") {
            if (block.payload.action === "nvl") {
                this.visitList(block.childrenIds, true);
                return;
            }
            this.applyAction(block, block.payload);
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "control") {
            if (block.payload.control === "condition") {
                this.visitCondition(block, insideNvl);
                return;
            }
            if (block.payload.control === "conditionBranch") {
                this.visitList(block.childrenIds, insideNvl);
                return;
            }
            if (block.payload.control === "repeat" && (block.payload.times ?? 1) !== 1) {
                this.diagnostic(block.id, "Preview applies repeated groups once.");
            }
            this.visitList(block.childrenIds, insideNvl);
            return;
        }

        if (block.kind === "jump") {
            this.diagnostic(block.id, "Preview ignores scene jumps.");
            return;
        }

        // code / note: no stage effect.
    }

    private visitChoice(block: Extract<StoryBlock, { kind: "nodeAction" }>, insideNvl: boolean): void {
        if (this.pathBlockIds.has(block.id)) {
            const option = block.childrenIds
                .map(childId => this.scene.blocks[childId])
                .find(child => child && this.pathBlockIds.has(child.id));
            if (option) {
                this.visitList(option.childrenIds, insideNvl);
                return;
            }
        }
        // A choice before the target: playback would take exactly one branch, but which one is
        // unknowable statically - assume none and continue after the menu.
        this.diagnostic(block.id, "Preview assumes no branch of this earlier choice was taken.");
    }

    private visitCondition(block: Extract<StoryBlock, { kind: "control" }>, insideNvl: boolean): void {
        const branches = block.childrenIds
            .map(childId => this.scene.blocks[childId])
            .filter((child): child is Extract<StoryBlock, { kind: "control" }> =>
                child?.kind === "control" && child.payload.control === "conditionBranch");

        if (this.pathBlockIds.has(block.id)) {
            const branch = branches.find(candidate => this.pathBlockIds.has(candidate.id));
            if (branch) {
                this.visitList(branch.childrenIds, insideNvl);
                return;
            }
        }
        for (const branch of branches) {
            if (branch.payload.control !== "conditionBranch") {
                continue;
            }
            if (branch.payload.branch === "else" || this.evaluateCondition(branch.payload.condition, branch.id)) {
                this.visitList(branch.childrenIds, insideNvl);
                return;
            }
        }
    }

    private evaluateCondition(condition: StoryConditionRef | undefined, blockId: string): boolean {
        if (!condition) {
            return false;
        }
        if (condition.kind === "expression") {
            if (!isStoryExpressionEvaluable(condition.expression.ast)) {
                this.diagnostic(blockId, `Condition \`${condition.expression.source}\` did not resolve; it evaluates false in the preview.`);
                return false;
            }
            // Unlike the blueprint branch below, this one really evaluates: the preview owns a variable
            // store, and the expression evaluator is the same pure function the compiler emits - so the
            // branch the author sees previewed is the branch the game will take from the same state.
            return isTruthy(evaluateStoryExpression(condition.expression.ast, ref => this.readVariable(ref, blockId)));
        }
        if (condition.kind === "blueprint") {
            // The preview follows the Studio-computed path when available; a blueprint condition that
            // is not on that path falls back to false rather than running the graph synchronously here.
            this.diagnostic(blockId, "Blueprint condition evaluates false in the preview.");
            return false;
        }
        const target = condition.target;
        let current: StoryLiteralValue | null | undefined;
        if (target.scope === "persistent") {
            this.diagnostic(blockId, "Persistent-variable condition evaluates against defaults in the preview.");
            current = undefined;
        } else if (target.scope === "scene") {
            const def = this.scene.sceneVariables?.[target.variableId];
            if (!def) {
                return false;
            }
            current = this.variables.scene.get(def.storageKey);
        } else {
            const def = this.document.savedVariables?.[target.variableId];
            if (!def) {
                return false;
            }
            current = this.variables.saved.get(def.storageKey);
        }
        switch (condition.operator) {
            case "isTrue":
                return current === true;
            case "isFalse":
                return current === false;
            case "equals":
                return current === condition.value;
            case "notEquals":
                return current !== condition.value;
            case "exists":
                return current !== null && current !== undefined;
            default:
                return false;
        }
    }

    private applyAction(block: StoryBlock, payload: StoryActionPayload): void {
        switch (payload.action) {
            case "setBackground": {
                if (payload.assetId) {
                    this.background = { assetId: payload.assetId };
                } else if (payload.color) {
                    this.background = { color: payload.color };
                }
                return;
            }
            case "character":
                this.applyCharacter(block, payload);
                return;
            case "image":
                this.applyImage(block, payload);
                return;
            case "displayable":
                this.applyDisplayable(block, payload);
                return;
            case "text":
                this.applyText(block, payload);
                return;
            case "layer":
                this.applyLayer(block, payload);
                return;
            case "setVariable":
                this.applySetVariable(block, payload);
                return;
            case "video":
                this.diagnostic(block.id, "Videos are not previewed.");
                return;
            case "blueprint":
                this.diagnostic(block.id, "Story Action Blueprint effects are not simulated in the preview.");
                return;
            // audio / wait / screenEffect / nvl: no settled visual state.
            default:
                return;
        }
    }

    private applyCharacter(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "character" }>): void {
        const objectName = getCharacterStageObjectName(payload);
        const record = this.ensure("image", objectName, block.id);
        record.autoFit = true;
        if (payload.operation === "exit") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform ?? { preset: "fadeOut", durationMs: 250 }, "hide", block.id));
            return;
        }
        if (payload.operation === "move") {
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "none", block.id));
            return;
        }
        // enter / expression update the source.
        record.source = payload.assetId
            ? { type: "asset", assetId: payload.assetId }
            : { type: "character", characterId: payload.characterId, formName: payload.formName, variants: payload.variants };
        if (payload.operation === "enter") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        }
    }

    private applyImage(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "image" }>): void {
        const record = this.ensure("image", payload.objectName, block.id);
        if (payload.autoFit !== undefined) {
            record.autoFit = payload.autoFit;
        }
        if (payload.layer) {
            record.layer = payload.layer;
        }
        if ((payload.operation === "create" || payload.operation === "setSource")) {
            if (payload.assetId) {
                record.source = { type: "asset", assetId: payload.assetId };
            } else if (payload.color) {
                record.source = { type: "color", color: payload.color };
            }
        }
        if (payload.operation === "show" || payload.operation === "create") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        } else if (payload.operation === "hide") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "hide", block.id));
        }
    }

    private applyText(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "text" }>): void {
        const record = this.ensure("text", payload.objectName, block.id);
        if ((payload.operation === "create" || payload.operation === "setText") && payload.text !== undefined) {
            record.text = payload.text;
        }
        if (payload.operation === "setFontSize" || (payload.operation === "create" && payload.fontSize !== undefined)) {
            record.fontSize = payload.fontSize ?? 16;
        }
        if (payload.operation === "setFontColor" || (payload.operation === "create" && payload.fontColor)) {
            record.fontColor = payload.fontColor ?? "#ffffff";
        }
        if (payload.operation === "create" && payload.fontSize === undefined && record.fontSize === undefined) {
            record.fontSize = 32;
        }
        if (payload.layer) {
            record.layer = payload.layer;
        }
        if (payload.operation === "show" || payload.operation === "create") {
            record.visible = true;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "show", block.id));
        } else if (payload.operation === "hide") {
            record.visible = false;
            record.props = mergeTransformProps(record.props, this.finalProps(payload.transform, "hide", block.id));
        }
    }

    private applyLayer(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "layer" }>): void {
        if (payload.operation === "create") {
            const record = this.ensure("layer", payload.objectName, block.id);
            if (payload.zIndex !== undefined) {
                record.zIndex = payload.zIndex;
            }
            return;
        }
        // Non-create layer ops address an existing target (built-in fallback: displayable layer).
        const targetProps = this.resolveLayerTargetProps(payload);
        if (payload.operation === "setZIndex") {
            if (targetProps.record) {
                targetProps.record.zIndex = payload.zIndex ?? 0;
            }
            return;
        }
        if (payload.operation === "show" || payload.operation === "hide" || payload.operation === "transform") {
            const visibility: VisibilityTransformMode = payload.operation === "transform" ? "none" : payload.operation;
            const props = this.finalProps(payload.transform, visibility, block.id);
            if (targetProps.record) {
                if (payload.operation !== "transform") {
                    targetProps.record.visible = payload.operation === "show";
                }
                targetProps.record.props = mergeTransformProps(targetProps.record.props, props);
            } else if (targetProps.builtin) {
                this.builtinLayerProps[targetProps.builtin] = mergeTransformProps(this.builtinLayerProps[targetProps.builtin], props);
            }
        }
    }

    private resolveLayerTargetProps(payload: Extract<StoryActionPayload, { action: "layer" }>): {
        record?: StageSnapshotDisplayable;
        builtin?: "backgroundLayer" | "displayableLayer";
    } {
        const target = payload.target;
        if (target?.kind === "default") {
            return { builtin: target.layer === "background" ? "backgroundLayer" : "displayableLayer" };
        }
        if (target?.kind === "custom") {
            const source = target.sourceBlockId ? this.scene.blocks[target.sourceBlockId] : undefined;
            const name = source?.kind === "action" && source.payload.action === "layer"
                ? source.payload.objectName
                : target.name;
            const record = this.displayables.get(this.key("layer", name ?? ""));
            return record ? { record } : { builtin: "displayableLayer" };
        }
        const record = this.displayables.get(this.key("layer", payload.objectName));
        return record ? { record } : { builtin: "displayableLayer" };
    }

    private applyDisplayable(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "displayable" }>): void {
        const bucket = this.resolveDisplayableBucket(payload, block.id);
        if (!bucket) {
            return;
        }
        const operation = payload.operation;
        if (operation === "show" || operation === "hide" || operation === "transform") {
            const visibility: VisibilityTransformMode = operation === "transform" ? "none" : operation;
            const props = this.finalProps(payload.transform, visibility, block.id);
            if (bucket.record) {
                if (operation !== "transform") {
                    bucket.record.visible = operation === "show";
                }
                bucket.record.props = mergeTransformProps(bucket.record.props, props);
            } else if (bucket.background) {
                this.backgroundProps = mergeTransformProps(this.backgroundProps, props);
            } else if (bucket.builtinLayer) {
                this.builtinLayerProps[bucket.builtinLayer] = mergeTransformProps(this.builtinLayerProps[bucket.builtinLayer], props);
            }
            return;
        }
        const effects = bucket.record?.effects ?? (bucket.background ? this.backgroundEffects : null);
        if (!effects) {
            return;
        }
        switch (operation) {
            case "mask":
                if (payload.maskAssetId) {
                    effects.mask = { assetId: payload.maskAssetId };
                }
                return;
            case "clearMask":
                effects.mask = "clear";
                return;
            case "clip":
                if (payload.clipPath) {
                    effects.clip = { clipPath: payload.clipPath };
                }
                return;
            case "clearClip":
                effects.clip = "clear";
                return;
            case "filter":
                if (payload.filter) {
                    effects.filter = { filter: payload.filter };
                }
                return;
            case "clearFilter":
                effects.filter = "clear";
                return;
            case "darken":
                effects.darkness = Math.min(1, Math.max(0, payload.darkness ?? 0));
                return;
            case "circleReveal":
                // Ends fully revealed.
                effects.clip = "clear";
                return;
            case "circleClose":
                effects.clip = { clipPath: "circle(0.0% at 50% 50%)" };
                return;
            case "wipe":
                // A completed wipe leaves the element fully revealed.
                effects.clip = "clear";
                return;
            default:
                return;
        }
    }

    private resolveDisplayableBucket(payload: Extract<StoryActionPayload, { action: "displayable" }>, blockId: string): {
        record?: StageSnapshotDisplayable;
        background?: boolean;
        builtinLayer?: "backgroundLayer" | "displayableLayer";
    } | null {
        const target = payload.target;
        if (target.builtin === "background") {
            return { background: true };
        }
        if (target.builtin === "backgroundLayer") {
            return { builtinLayer: "backgroundLayer" };
        }
        if (target.builtin === "displayableLayer") {
            return { builtinLayer: "displayableLayer" };
        }
        const resolved = resolveDisplayableTargetRef(this.scene, target);
        const kind = resolved.kind === "character" || !resolved.kind ? "image" : resolved.kind;
        const record = this.displayables.get(this.key(kind === "text" ? "text" : kind === "layer" ? "layer" : "image", resolved.name));
        if (!record) {
            this.diagnostic(blockId, `Displayable target not found: ${resolved.label || resolved.name || "(empty)"}`);
            return null;
        }
        return { record };
    }

    private applySetVariable(block: StoryBlock, payload: Extract<StoryActionPayload, { action: "setVariable" }>): void {
        const target = payload.target;
        const value = this.resolveAssignedValue(block, payload);
        if (value === undefined) {
            return;
        }
        if (target.scope === "scene") {
            const def = this.scene.sceneVariables?.[target.variableId];
            if (!def) {
                return;
            }
            this.variables.scene.set(def.storageKey, value);
            this.assignedScene[def.storageKey] = value;
            return;
        }
        if (target.scope === "saved") {
            const def = this.document.savedVariables?.[target.variableId];
            if (!def) {
                return;
            }
            this.variables.saved.set(def.storageKey, value);
            this.assignedSaved[def.storageKey] = value;
            return;
        }
        this.diagnostic(block.id, "Persistent-variable assignments are not applied in the preview.");
    }

    /**
     * The value a `setVariable` row settles on: its literal, or its expression evaluated against the
     * variables this walk has accumulated so far. `undefined` means "do not assign".
     *
     * The preview runs the same evaluator as the compiler, so `/set gold gold + 1` moves the counter
     * here exactly as it will in the game. What differs is the starting state - this walk seeds from
     * declared defaults and has no host persistence - which is why a persistent read is reported
     * rather than silently folded in as `null`.
     */
    private resolveAssignedValue(
        block: StoryBlock,
        payload: Extract<StoryActionPayload, { action: "setVariable" }>,
    ): StoryLiteralValue | undefined {
        if (!payload.expression) {
            return payload.value;
        }
        if (!isStoryExpressionEvaluable(payload.expression.ast)) {
            this.diagnostic(block.id, `Expression \`${payload.expression.source}\` did not resolve; the assignment was skipped in the preview.`);
            return undefined;
        }
        return evaluateStoryExpression(payload.expression.ast, ref => this.readVariable(ref, block.id));
    }

    /** Read a variable out of the preview's own store. Persistent variables have no preview backing. */
    private readVariable(ref: StoryVariableRef, blockId: string): StoryLiteralValue | undefined {
        if (ref.scope === "persistent") {
            this.diagnostic(blockId, "Persistent variables read as empty in the preview.");
            return undefined;
        }
        if (ref.scope === "scene") {
            const def = this.scene.sceneVariables?.[ref.variableId];
            return def ? this.variables.scene.get(def.storageKey) : undefined;
        }
        const def = this.document.savedVariables?.[ref.variableId];
        return def ? this.variables.saved.get(def.storageKey) : undefined;
    }

    private finalProps(transform: StoryTransformRef | undefined, visibility: VisibilityTransformMode, blockId: string): Record<string, unknown> {
        return storyTransformRefFinalProps(transform, visibility, this.animations, message => this.diagnostic(blockId, message));
    }

    private ensure(kind: "image" | "text" | "layer", objectName: string | undefined, sourceBlockId: string): StageSnapshotDisplayable {
        const key = this.key(kind, objectName ?? "");
        const existing = this.displayables.get(key);
        if (existing) {
            return existing;
        }
        const record: StageSnapshotDisplayable = {
            kind,
            objectName: normalizeObjectName(objectName),
            sourceBlockId,
            // NLR defaults: images/texts mount hidden (opacity 0); layers mount visible (opacity 1).
            visible: kind === "layer",
            props: {},
            effects: {},
        };
        this.displayables.set(key, record);
        this.order.push(key);
        return record;
    }

    private key(kind: "image" | "text" | "layer", objectName: string): string {
        return `${kind}:${normalizeObjectName(objectName)}`;
    }

    private diagnostic(blockId: string | undefined, message: string): void {
        this.diagnostics.push({ level: "warning", blockId, message });
    }
}
