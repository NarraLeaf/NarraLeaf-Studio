import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { ProjectDocumentTooNewError } from "@shared/documents/newerSchema";
import { describeProjectDocumentTooNew } from "@shared/documents/tooNewMessage";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import {
    UI_DOCUMENT_MIN_SUPPORTED_VERSION,
    UI_DOCUMENT_SCHEMA_VERSION,
    getUIComponentLink,
    type UIElement,
    type UIDocument,
    type UIStageSurface,
} from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { Services } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { UIDocumentService } from "./UIDocumentService";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_GAME_CHOOSE,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR,
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";

function ownerKeyForTest(owner: BlueprintOwnerRef): string {
    switch (owner.kind) {
        case "globalMain":
            return "globalMain";
        case "surfaceMain":
            return encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId: owner.surfaceId });
        case "widgetMain":
            return encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: owner.surfaceId, elementId: owner.elementId });
        case "widgetValue":
            return encodeBlueprintOwnerKey({ kind: "widgetValue", surfaceId: owner.surfaceId, elementId: owner.elementId, propPath: owner.propPath });
        case "componentWidgetMain":
            return encodeBlueprintOwnerKey({ kind: "componentWidgetMain", componentId: owner.componentId, elementId: owner.elementId });
        case "storyAction":
            return encodeBlueprintOwnerKey({ kind: "storyAction", blueprintId: owner.blueprintId });
        default: {
            const _exhaustive: never = owner;
            return _exhaustive;
        }
    }
}

/** What {@link UIDocumentService} asked to be recorded, in the order it asked. */
type RecordedHistoryCall = { surfaceId: string; mergeKey?: string };

function createHarness(options: { withLocalBlueprint?: boolean; withHistory?: boolean } = {}) {
    let nextId = 0;
    const service = new UIDocumentService();
    const projectHistory = new HistoryService();
    const historyCalls: RecordedHistoryCall[] = [];
    const historyService = {
        // Enough of the real service for the recording decision: the snapshots themselves are
        // `UIEditorHistoryService`'s business and are covered by its own tests.
        captureSnapshot: (surfaceId: string) => ({ surfaceId }),
        record: (call: { surfaceId: string; mergeKey?: string }) => {
            historyCalls.push({ surfaceId: call.surfaceId, mergeKey: call.mergeKey });
        },
    };
    const blueprintDocument: any = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        persistentVariables: {},
        meta: {},
    };
    const createGraphBlueprint = (id: string, name: string, owner: BlueprintOwnerRef) => {
        blueprintDocument.blueprints[id] = blueprintDocument.blueprints[id] ?? {
            id,
            name,
            owner,
            graphs: {
                events: {},
                functions: {},
            },
            members: {
                variables: {},
                fields: {},
                functions: {},
            },
            bindings: {},
        };
        const ownerKey = ownerKeyForTest(owner);
        const prev = blueprintDocument.ownerRecords[ownerKey];
        blueprintDocument.ownerRecords[ownerKey] = {
            blueprintId: id,
            privateBlueprintIds: prev?.privateBlueprintIds?.includes(id)
                ? prev.privateBlueprintIds
                : [...(prev?.privateBlueprintIds ?? []), id],
        };
        return id;
    };
    const localBlueprintService = {
        ensureWidgetMain: (surfaceId: string, elementId: string, displayName?: string) =>
            createGraphBlueprint(`widget-main-${elementId}`, displayName ?? "Widget", {
                kind: "widgetMain",
                surfaceId,
                elementId,
            }),
        ensureWidgetValueBlueprint: (input: { surfaceId: string; elementId: string; propPath: string; displayName?: string }) => {
            const id = createGraphBlueprint(`widget-value-${input.elementId}-${input.propPath}`, input.displayName ?? "Value", {
                kind: "widgetValue",
                surfaceId: input.surfaceId,
                elementId: input.elementId,
                propPath: input.propPath,
            });
            const blueprint = blueprintDocument.blueprints[id];
            blueprint.graphs.events.init = blueprint.graphs.events.init ?? {
                id: "init",
                name: "Init",
                graph: { nodes: {}, edges: [] },
            };
            return id;
        },
        applyBlueprintMutation: (mutator: (doc: any) => void) => mutator(blueprintDocument),
        getBlueprintDocument: () => blueprintDocument,
    };
    service.setContext({
        project: {
            resolve: (name: string) => name,
        } as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => `generated-id-${++nextId}` };
                }
                if (serviceId === Services.Project) {
                    return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                }
                if (options.withLocalBlueprint && serviceId === Services.LocalBlueprint) {
                    return localBlueprintService;
                }
                if (options.withHistory && serviceId === Services.UIEditorHistory) {
                    return historyService;
                }
                // The workspace-wide stack, which is a different service from the interface
                // editor's own per-surface history above. Reordering the surface list is the one
                // thing this service puts there.
                if (serviceId === Services.History) {
                    return projectHistory;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });

    const initialDocument = (service as any).createEmptyDocument();
    (service as any).document = initialDocument;

    return { service, initialDocument, blueprintDocument, createGraphBlueprint, historyCalls, projectHistory };
}

describe("UIDocumentService surface creation", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("creates app Pages with blocking exit animation enabled by default", () => {
        const { service, initialDocument } = createHarness();

        expect(initialDocument.surfaces[0]?.settings?.pageAnimation).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(initialDocument.surfaces[0]?.settings?.pageAnimation?.exitBlocking).toBe(true);

        const page = service.createSurface({
            kind: "appSurface",
            host: "app",
            name: "Settings",
        });

        expect(page.settings?.pageAnimation).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(page.settings?.pageAnimation?.exitBlocking).toBe(true);
    });

    it("preserves explicit Page animation wait choices while Game UI defaults to transparent", () => {
        const { service } = createHarness();

        const page = service.createSurface({
            kind: "appSurface",
            host: "app",
            name: "Fast Page",
            settings: {
                backgroundColor: "#111111",
                pageAnimation: {
                    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
                    exitBlocking: false,
                },
            },
        });
        const gameUi = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
        });

        expect(page.settings?.backgroundColor).toBe("#111111");
        expect(page.settings?.pageAnimation?.exitBlocking).toBe(false);
        expect(gameUi.settings?.pageAnimation).toBeUndefined();
        expect(gameUi.settings?.backgroundColor).toBe("transparent");
        expect(gameUi.kind === "stageSurface" ? gameUi.mount.slotId : null).toBe("onStage");
    });

    it("creates Dialog Game UI with slot mount and decoupled dialog template", () => {
        const { service } = createHarness();

        const dialog = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[dialog.rootElementId]!;
        const interactionLayer = doc.elements[root.childrenIds[0]!]!;
        const panel = doc.elements[root.childrenIds[1]!]!;
        const stack = doc.elements[panel.childrenIds[0]!]!;
        const avatar = doc.elements[panel.childrenIds[1]!]!;
        const nametag = doc.elements[stack.childrenIds[0]!]!;
        const sentence = doc.elements[stack.childrenIds[1]!]!;
        const children = stack.childrenIds.map(id => doc.elements[id]!.type);

        expect(root.childrenIds).toHaveLength(2);
        expect(dialog.mount.slotId).toBe("dialog");
        expect(dialog.settings?.backgroundColor).toBe("transparent");
        expect(interactionLayer.type).toBe("nl.container");
        expect(interactionLayer.layout).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
        expect(interactionLayer.childrenIds).toEqual([]);
        expect(interactionLayer.props).toMatchObject({
            fillVisible: false,
            strokeVisible: false,
            borderWidth: 0,
        });
        expect(panel.type).toBe("nl.container");
        expect(panel.parentId).toBe(root.id);
        expect(children).toEqual(["nl.text", "nl.dialog.sentence"]);
        expect(nametag.type).toBe("nl.text");
        expect(sentence.type).toBe("nl.dialog.sentence");
        expect(avatar.type).toBe("nl.image");
        expect(avatar.parentId).toBe(panel.id);
        // Square, vertically centred in the panel, and the text column pays for it in left padding.
        expect(avatar.layout).toMatchObject({ x: 28, y: 22, width: 136, height: 136 });
        expect(avatar.props).toMatchObject({
            fillType: "image",
            imageFill: { mode: "cover", assetId: null },
            strokeVisible: false,
            borderWidth: 0,
        });
        expect(stack.props?.stackPaddingLeft).toBe(188);
        expect(sentence.layout.width).toBe(panel.layout.width - 188 - 28);
        expect(interactionLayer.props?.appearance).toBeTruthy();
        expect(panel.props?.appearance).toBeTruthy();
        expect(stack.props?.appearance).toBeTruthy();
        expect(nametag.props?.appearance).toBeTruthy();
        expect(sentence.props?.appearance).toBeTruthy();
        expect(avatar.props?.appearance).toBeTruthy();
    });

    it("wires default Dialog template blueprints for Next, Nametag and Avatar updates", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });

        const dialog = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[dialog.rootElementId]!;
        const interactionLayer = doc.elements[root.childrenIds[0]!]!;
        const panel = doc.elements[root.childrenIds[1]!]!;
        const stack = doc.elements[panel.childrenIds[0]!]!;
        const avatar = doc.elements[panel.childrenIds[1]!]!;
        const nametag = doc.elements[stack.childrenIds[0]!]!;
        const sentence = doc.elements[stack.childrenIds[1]!]!;

        expect(blueprintDocument.blueprints[`widget-main-${panel.id}`]).toBeUndefined();
        const contentBlueprint = blueprintDocument.blueprints[`widget-main-${stack.id}`];
        expect(contentBlueprint.owner).toMatchObject({ kind: "widgetMain", elementId: stack.id });
        expect(Object.keys(contentBlueprint.graphs.events)).toEqual(["dialogNext"]);
        const nextGraph = contentBlueprint.graphs.events.dialogNext.graph;
        const nextNodes = Object.values(nextGraph.nodes) as any[];
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        const elementClickTargets = nextNodes
            .filter((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)
            .map((node: any) => [node.params?.elementId, node.params?.elementType]);
        expect(elementClickTargets).toHaveLength(5);
        expect(elementClickTargets).toEqual(expect.arrayContaining([
            [interactionLayer.id, "nl.container"],
            [panel.id, "nl.container"],
            [avatar.id, "nl.image"],
            [nametag.id, "nl.text"],
            [sentence.id, "nl.dialog.sentence"],
        ]));
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_NEXT)).toBe(true);
        expect(nextNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP &&
            node.params?.[BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME] === " "
        )).toBe(true);
        const nextIncomingEdges = nextGraph.edges.filter((edge: any) => edge.to.nodeId === "dialog.next" && edge.to.port === "in");
        expect(nextIncomingEdges).toHaveLength(7);
        const outgoingKeys = nextGraph.edges.map((edge: any) => `${edge.from.nodeId}:${edge.from.port}`);
        expect(new Set(outgoingKeys).size).toBe(outgoingKeys.length);

        expect(nametag.valueBindings?.text).toBeUndefined();
        const nametagBlueprint = blueprintDocument.blueprints[`widget-main-${nametag.id}`];
        expect(nametagBlueprint.owner).toMatchObject({ kind: "widgetMain", elementId: nametag.id });
        expect(Object.keys(nametagBlueprint.graphs.events)).toEqual(["nametagUpdate"]);
        const nametagGraph = nametagBlueprint.graphs.events.nametagUpdate.graph;
        const nametagNodeTypes = new Set(Object.values(nametagGraph.nodes).map((node: any) => node.type));
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)).toBe(true);
        expect(Object.values(nametagGraph.nodes).filter((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)).toHaveLength(2);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_DATA_NOT_NULL)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);

        const avatarBlueprint = blueprintDocument.blueprints[`widget-main-${avatar.id}`];
        expect(avatarBlueprint.owner).toMatchObject({ kind: "widgetMain", elementId: avatar.id });
        expect(Object.keys(avatarBlueprint.graphs.events)).toEqual(["avatarUpdate"]);
        const avatarGraph = avatarBlueprint.graphs.events.avatarUpdate.graph;
        const avatarNodeTypes = new Set(Object.values(avatarGraph.nodes).map((node: any) => node.type));
        expect(avatarNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(avatarNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(true);
        expect(avatarNodeTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_SPEAKER_AVATAR)).toBe(true);
        expect(avatarNodeTypes.has(BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET)).toBe(true);
        // Both heads drive the same setter, and the avatar reaches it as a data pin - not a param.
        const setAssetIncoming = avatarGraph.edges.filter((edge: any) =>
            edge.to.nodeId === "avatar.update.setImageAsset" && edge.to.port === "in"
        );
        expect(setAssetIncoming).toHaveLength(2);
        expect(avatarGraph.edges).toEqual(expect.arrayContaining([{
            from: { nodeId: "avatar.update.get", port: "avatar" },
            to: { nodeId: "avatar.update.setImageAsset", port: "asset" },
        }]));
    });

    it("creates Notification Game UI with a list-driven template and message value binding", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });

        const notification = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Notification",
            stageMount: { kind: "slot", slotId: "notification" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[notification.rootElementId]!;
        const list = doc.elements[root.childrenIds[0]!]!;
        const itemContainer = doc.elements[list.childrenIds[0]!]!;
        const itemText = doc.elements[itemContainer.childrenIds[0]!]!;

        expect(notification.mount.slotId).toBe("notification");
        expect(list.type).toBe("nl.notification.list");
        expect(list.props).toMatchObject({ itemKeyFieldId: "id", itemGap: 12 });
        expect(itemContainer.type).toBe("nl.container");
        expect(itemContainer.extra?.listSlot).toBe("itemTemplate");
        expect(itemText.type).toBe("nl.text");
        expect(itemText.valueBindings?.text).toMatchObject({ kind: "blueprintValue", valueType: "string" });

        const valueBlueprint = blueprintDocument.blueprints[`widget-value-${itemText.id}-text`];
        const valueGraph = valueBlueprint.graphs.events.init.graph;
        const valueNodes = Object.values(valueGraph.nodes) as any[];
        expect(valueNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS)).toBe(true);
        expect(valueNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET && node.params?.path === "message"
        )).toBe(true);
        expect(valueNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE)).toBe(true);
    });

    it("creates Choice Game UI with select wiring and item text value binding", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });

        const choice = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Choice",
            stageMount: { kind: "slot", slotId: "choice" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[choice.rootElementId]!;
        const list = doc.elements[root.childrenIds[0]!]!;
        const itemContainer = doc.elements[list.childrenIds[0]!]!;
        const itemText = doc.elements[itemContainer.childrenIds[0]!]!;

        expect(choice.mount.slotId).toBe("choice");
        expect(list.type).toBe("nl.choice.list");
        expect(list.props).toMatchObject({ itemKeyFieldId: "index", itemGap: 16 });
        expect(itemContainer.extra?.listSlot).toBe("itemTemplate");
        expect(itemText.valueBindings?.text).toMatchObject({ kind: "blueprintValue", valueType: "string" });

        const valueBlueprint = blueprintDocument.blueprints[`widget-value-${itemText.id}-text`];
        const valueNodes = Object.values(valueBlueprint.graphs.events.init.graph.nodes) as any[];
        expect(valueNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET && node.params?.path === "text"
        )).toBe(true);

        const listBlueprint = blueprintDocument.blueprints[`widget-main-${list.id}`];
        expect(Object.keys(listBlueprint.graphs.events)).toEqual(["choiceSelect"]);
        const selectGraph = listBlueprint.graphs.events.choiceSelect.graph;
        const selectNodes = Object.values(selectGraph.nodes) as any[];
        expect(selectNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK)).toBe(true);
        expect(selectNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_CHOOSE)).toBe(true);
        const edgeKeys = selectGraph.edges.map((edge: any) =>
            `${edge.from.port}->${edge.to.port}`
        );
        expect(edgeKeys).toEqual(expect.arrayContaining(["then->in", "index->index"]));
    });

    it("creates NVL Game UI with next wiring, nametag binding, and the NVL texts leaf", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });

        const nvl = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "NVL",
            stageMount: { kind: "slot", slotId: "nvl" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[nvl.rootElementId]!;
        const interactionLayer = doc.elements[root.childrenIds[0]!]!;
        const panel = doc.elements[root.childrenIds[1]!]!;
        const list = doc.elements[panel.childrenIds[0]!]!;
        const nametag = doc.elements[list.childrenIds[0]!]!;
        const texts = doc.elements[list.childrenIds[1]!]!;

        expect(nvl.mount.slotId).toBe("nvl");
        expect(interactionLayer.type).toBe("nl.container");
        expect(list.type).toBe("nl.nvl.list");
        expect(nametag.type).toBe("nl.text");
        expect(nametag.extra?.listSlot).toBe("itemTemplate");
        expect(texts.type).toBe("nl.nvl.texts");
        expect(texts.extra?.listSlot).toBe("itemTemplate");
        expect(nametag.valueBindings?.text).toMatchObject({ kind: "blueprintValue", valueType: "string" });

        const valueBlueprint = blueprintDocument.blueprints[`widget-value-${nametag.id}-text`];
        const valueNodes = Object.values(valueBlueprint.graphs.events.init.graph.nodes) as any[];
        expect(valueNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET && node.params?.path === "nametag"
        )).toBe(true);

        // Advancement graph is hosted on the Panel (nl.container) because the NVL List is a
        // collection widget without a Mouse Click head.
        expect(blueprintDocument.blueprints[`widget-main-${list.id}`]).toBeUndefined();
        const panelBlueprint = blueprintDocument.blueprints[`widget-main-${panel.id}`];
        expect(Object.keys(panelBlueprint.graphs.events)).toEqual(["nvlNext"]);
        const nextGraph = panelBlueprint.graphs.events.nvlNext.graph;
        const nextNodes = Object.values(nextGraph.nodes) as any[];
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_NEXT)).toBe(true);
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        expect(nextNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP &&
            node.params?.[BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME] === " "
        )).toBe(true);
        const elementClickTargets = nextNodes
            .filter((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)
            .map((node: any) => node.params?.elementId);
        expect(elementClickTargets).toEqual([interactionLayer.id]);
    });

    it("creates On-Stage Game UI as a bare transparent root", () => {
        const { service } = createHarness({ withLocalBlueprint: true });

        const onStage = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "HUD",
            stageMount: { kind: "slot", slotId: "onStage" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[onStage.rootElementId]!;

        expect(onStage.mount.slotId).toBe("onStage");
        expect(onStage.settings?.backgroundColor).toBe("transparent");
        expect(root.childrenIds).toEqual([]);
    });

    it("returns the existing active Game UI when creating a duplicate slot", () => {
        const { service } = createHarness();

        const first = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        });
        const second = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog Duplicate",
            stageMount: { kind: "slot", slotId: "dialog" },
        });

        const dialogSurfaces = service.getDocument().surfaces.filter(surface =>
            surface.kind === "stageSurface" && surface.mount.slotId === "dialog"
        );
        expect(second.id).toBe(first.id);
        expect(dialogSurfaces).toHaveLength(1);
        expect(dialogSurfaces[0]?.name).toBe("Dialog");
    });

    it("repairs missing serialized appearance on existing Dialog Game UI templates", () => {
        const { service } = createHarness();

        const dialog = service.createSurface({
            kind: "stageSurface",
            host: "player",
            name: "Dialog",
            stageMount: { kind: "slot", slotId: "dialog" },
        }) as UIStageSurface;
        const doc = service.getDocument();
        const root = doc.elements[dialog.rootElementId]!;
        const interactionLayer = doc.elements[root.childrenIds[0]!]!;
        const panel = doc.elements[root.childrenIds[1]!]!;
        const stack = doc.elements[panel.childrenIds[0]!]!;
        const nametag = doc.elements[stack.childrenIds[0]!]!;
        const sentence = doc.elements[stack.childrenIds[1]!]!;
        for (const element of [interactionLayer, panel, stack, nametag, sentence]) {
            delete element.props?.appearance;
        }

        const migrated = (service as any).migrateIfNeeded(doc) as UIDocument;

        expect(migrated.elements[interactionLayer.id]!.props?.appearance).toBeTruthy();
        expect(migrated.elements[panel.id]!.props?.appearance).toBeTruthy();
        expect(migrated.elements[stack.id]!.props?.appearance).toBeTruthy();
        expect(migrated.elements[nametag.id]!.props?.appearance).toBeTruthy();
        expect(migrated.elements[sentence.id]!.props?.appearance).toBeTruthy();
    });

    it("normalizes stage mounts and slot aliases", () => {
        // Not a version step and never was: `normalizeSpecialChildSlots` runs on every read, so a
        // surface whose mount names a slot this build has no reading for lands `onStage` whatever
        // version the document claims. The floor is used here only to prove it is not gated on one.
        const { service } = createHarness();
        const base = service.getDocument();
        const migrated = (service as any).migrateIfNeeded({
            ...base,
            schemaVersion: UI_DOCUMENT_MIN_SUPPORTED_VERSION,
            surfaces: [
                base.surfaces[0]!,
                {
                    id: "legacy-menu",
                    name: "Menu",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "slot", slotId: "menu" },
                },
                {
                    id: "legacy-layer",
                    name: "Layer",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "layer" },
                },
                {
                    id: "legacy-missing",
                    name: "Missing",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: base.surfaces[0]!.rootElementId,
                    settings: {},
                    mount: { kind: "slot", slotId: "unknown" },
                },
            ],
        } as UIDocument) as UIDocument;

        const slots = new Map(
            migrated.surfaces
                .filter((surface): surface is UIStageSurface => surface.kind === "stageSurface")
                .map(surface => [surface.id, surface.mount.slotId]),
        );
        expect(migrated.schemaVersion).toBe(UI_DOCUMENT_SCHEMA_VERSION);
        expect(slots.get("legacy-menu")).toBe("choice");
        expect(slots.get("legacy-layer")).toBe("onStage");
        expect(slots.get("legacy-missing")).toBe("onStage");
        for (const surface of migrated.surfaces.filter((surface): surface is UIStageSurface => surface.kind === "stageSurface")) {
            expect(surface.mount.kind).toBe("slot");
            expect(surface.settings?.backgroundColor).toBe("transparent");
        }
    });

    it.each([[1], [5], [UI_DOCUMENT_MIN_SUPPORTED_VERSION - 1]])(
        "refuses a v%i document rather than reading it as one whose fields are merely absent",
        version => {
            const { service } = createHarness();
            expect(() => (service as any).migrateIfNeeded({ ...service.getDocument(), schemaVersion: version }))
                .toThrow(/older than this Studio version can read/);
        },
    );

    it("refuses a newer document by naming both versions and the file", () => {
        const { service } = createHarness();
        const version = UI_DOCUMENT_SCHEMA_VERSION + 1;

        let thrown: unknown;
        try {
            (service as any).migrateIfNeeded({ ...service.getDocument(), schemaVersion: version });
        } catch (error) {
            thrown = error;
        }

        // "Newer than this Studio version" on its own cannot tell an author a damaged file from a
        // project a newer Studio has already opened, and those call for opposite actions - restore
        // the file, or update Studio. Both numbers and the file's own path are what separates them.
        const message = (thrown as Error).message;
        expect(message).toContain("editor/ui/uidoc.json");
        expect(message).toContain(`v${version}`);
        expect(message).toContain(`v${UI_DOCUMENT_SCHEMA_VERSION}`);

        // The same refusal value every other project document throws, carried as the cause: a
        // caller that wants to act on this failure matches on the type rather than on the sentence.
        const cause = (thrown as Error).cause;
        expect(cause).toBeInstanceOf(ProjectDocumentTooNewError);
        expect((cause as ProjectDocumentTooNewError).kind).toBe("uiDocument");
        expect((cause as ProjectDocumentTooNewError).version).toBe(version);
        expect((cause as ProjectDocumentTooNewError).supportedVersion).toBe(UI_DOCUMENT_SCHEMA_VERSION);

        // And it is the one wording, not a second one written here: the story document's refusal
        // says the same thing about a different file.
        expect(message).toBe(describeProjectDocumentTooNew(cause as ProjectDocumentTooNewError));
    });

    it("renames the main Page display name while preserving the main surface id", () => {
        const { service } = createHarness();
        const mainSurface = service.getDocument().surfaces.find(surface => surface.id === MAIN_APP_SURFACE_ID);

        expect(mainSurface).toBeDefined();
        service.renameSurface(MAIN_APP_SURFACE_ID, "Title Screen");
        expect(mainSurface?.name).toBe("Title Screen");

        service.updateSurface(MAIN_APP_SURFACE_ID, surface => {
            surface.id = "drifted-main-surface";
            surface.name = "Start";
        });
        expect(mainSurface?.id).toBe(MAIN_APP_SURFACE_ID);
        expect(mainSurface?.name).toBe("Start");

        (service as any).ensureMainSurface(service.getDocument());
        expect(mainSurface?.id).toBe(MAIN_APP_SURFACE_ID);
        expect(mainSurface?.name).toBe("Start");
    });

    it("records a surface's own edits in that surface's undo stack", () => {
        // These were the one kind of edit in the interface editor with no history behind them:
        // `mutateDocument` records only for a caller that names a surface, and neither of these
        // did - so Ctrl+Z could not take back a page's name or its background.
        const { service, historyCalls } = createHarness({ withHistory: true });

        service.renameSurface(MAIN_APP_SURFACE_ID, "Title Screen");
        service.updateSurface(MAIN_APP_SURFACE_ID, surface => {
            surface.settings = { ...(surface.settings ?? {}), backgroundColor: "#123456" };
        }, { mergeKey: "surface:main:backgroundColor" });

        expect(historyCalls).toEqual([
            { surfaceId: MAIN_APP_SURFACE_ID, mergeKey: `surface:${MAIN_APP_SURFACE_ID}:name` },
            { surfaceId: MAIN_APP_SURFACE_ID, mergeKey: "surface:main:backgroundColor" },
        ]);
    });

    it("duplicates Pages with independent elements and private blueprints", () => {
        const { service, blueprintDocument, createGraphBlueprint } = createHarness({ withLocalBlueprint: true });
        const source = service.createSurface({
            kind: "appSurface",
            host: "app",
            name: "Inventory",
        });
        const component = service.createEmptyComponent("Shared CTA");
        const componentBlueprintId = createGraphBlueprint("bp-component", "Shared CTA Logic", {
            kind: "componentWidgetMain",
            componentId: component.id,
            elementId: component.rootElementId,
        });

        const doc = service.getDocument();
        const root = doc.elements[source.rootElementId]!;
        const label: UIElement = {
            id: "source-label",
            type: "nl.text",
            name: "Label",
            parentId: "source-button",
            childrenIds: [],
            layout: { x: 8, y: 8, width: 80, height: 20 },
        };
        const button: UIElement = {
            id: "source-button",
            type: "nl.button",
            name: "Open Button",
            parentId: root.id,
            childrenIds: [label.id],
            layout: { x: 20, y: 30, width: 140, height: 48 },
            props: {
                label: "Open",
                targetSurfaceId: source.id,
                nested: {
                    surfaceId: source.id,
                    elementId: label.id,
                },
            },
        };
        root.childrenIds.push(button.id);
        doc.elements[button.id] = button;
        doc.elements[label.id] = label;
        const linkedInstance = service.createComponentInstance(root.id, component.id, {
            x: 240,
            y: 30,
            width: 160,
            height: 64,
        });

        const surfaceBlueprintId = createGraphBlueprint("bp-surface", "Inventory Logic", {
            kind: "surfaceMain",
            surfaceId: source.id,
        });
        const widgetBlueprintId = createGraphBlueprint("bp-widget", "Button Logic", {
            kind: "widgetMain",
            surfaceId: source.id,
            elementId: button.id,
        });
        const valueBlueprintId = createGraphBlueprint("bp-value", "Button Label Value", {
            kind: "widgetValue",
            surfaceId: source.id,
            elementId: button.id,
            propPath: "label",
        });
        button.valueBindings = {
            label: { kind: "blueprintValue", blueprintId: valueBlueprintId, valueType: "string" },
        };

        const surfaceBlueprint = blueprintDocument.blueprints[surfaceBlueprintId];
        surfaceBlueprint.members.fields["field-surface"] = { id: "field-surface", name: "Title" };
        surfaceBlueprint.bindings["bind-surface"] = {
            id: "bind-surface",
            target: {
                kind: "widgetProp",
                surfaceId: source.id,
                elementId: button.id,
                propPath: "label",
            },
            source: {
                kind: "field",
                blueprintId: surfaceBlueprintId,
                fieldId: "field-surface",
            },
            mode: "replace",
            status: "active",
        };
        surfaceBlueprint.graphs.events.init = {
            id: "init",
            graph: {
                nodes: {
                    "node-self": {
                        id: "node-self",
                        type: "test.node",
                        params: {
                            surfaceId: source.id,
                            targetSurfaceId: source.id,
                            elementId: button.id,
                            blueprintId: surfaceBlueprintId,
                        },
                    },
                },
                edges: [],
            },
        };

        const widgetBlueprint = blueprintDocument.blueprints[widgetBlueprintId];
        widgetBlueprint.members.fields["field-widget"] = { id: "field-widget", name: "Enabled" };
        widgetBlueprint.bindings["bind-widget"] = {
            id: "bind-widget",
            target: {
                kind: "widgetProp",
                surfaceId: source.id,
                elementId: button.id,
                propPath: "layout.visible",
            },
            source: {
                kind: "field",
                blueprintId: widgetBlueprintId,
                fieldId: "field-widget",
            },
            mode: "replace",
            status: "active",
        };
        widgetBlueprint.graphs.events.click = {
            id: "click",
            graph: {
                nodes: {
                    "node-target": {
                        id: "node-target",
                        type: "test.widget",
                        params: {
                            surfaceId: source.id,
                            elementId: label.id,
                            blueprintId: widgetBlueprintId,
                        },
                    },
                },
                edges: [],
            },
        };

        const duplicated = service.duplicateSurface(source.id)!;
        const duplicatedDoc = service.getDocument();
        const duplicatedRoot = duplicatedDoc.elements[duplicated.rootElementId]!;
        const duplicatedChildren = duplicatedRoot.childrenIds.map(id => duplicatedDoc.elements[id]!);
        const duplicatedButton = duplicatedChildren.find(element => element.name === "Open Button")!;
        const duplicatedLabel = duplicatedDoc.elements[duplicatedButton.childrenIds[0]!]!;
        const duplicatedLinkedInstance = duplicatedChildren.find(element => getUIComponentLink(element)?.componentId === component.id)!;

        expect(duplicated).toMatchObject({
            name: "Inventory Copy",
            kind: "appSurface",
            host: "app",
        });
        expect(duplicated.id).not.toBe(source.id);
        expect(duplicated.rootElementId).not.toBe(source.rootElementId);
        expect(duplicatedButton.id).not.toBe(button.id);
        expect(duplicatedLabel.id).not.toBe(label.id);
        expect(duplicatedButton.parentId).toBe(duplicated.rootElementId);
        expect(duplicatedButton.props).toMatchObject({
            targetSurfaceId: duplicated.id,
            nested: {
                surfaceId: duplicated.id,
                elementId: duplicatedLabel.id,
            },
        });
        expect(duplicatedLinkedInstance.id).not.toBe(linkedInstance.id);
        expect(getUIComponentLink(duplicatedLinkedInstance)).toEqual({ componentId: component.id, linked: true });
        expect(duplicatedDoc.components).toHaveLength(1);

        const duplicatedWidgetBlueprintId =
            blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: duplicated.id, elementId: duplicatedButton.id })]?.blueprintId;
        expect(duplicatedWidgetBlueprintId).toBeTruthy();
        if (!duplicatedWidgetBlueprintId) {
            throw new Error("Expected the duplicated button to own a blueprint");
        }
        const duplicatedLabelBinding = duplicatedButton.valueBindings?.label;
        const duplicatedValueBlueprintId =
            duplicatedLabelBinding?.kind === "blueprintValue" ? duplicatedLabelBinding.blueprintId : undefined;
        const duplicatedSurfaceBlueprintId = blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId: duplicated.id })]?.blueprintId;

        expect(duplicatedSurfaceBlueprintId).toBeTruthy();
        expect(duplicatedSurfaceBlueprintId).not.toBe(surfaceBlueprintId);
        expect(duplicatedWidgetBlueprintId).not.toBe(widgetBlueprintId);
        expect(duplicatedValueBlueprintId).toBeTruthy();
        expect(duplicatedValueBlueprintId).not.toBe(valueBlueprintId);
        if (!duplicatedValueBlueprintId) {
            throw new Error("Expected duplicated value blueprint binding");
        }

        expect(blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "surfaceMain", surfaceId: source.id })]?.blueprintId).toBe(surfaceBlueprintId);
        expect(blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: source.id, elementId: button.id })]?.blueprintId).toBe(widgetBlueprintId);
        expect(blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "widgetValue", surfaceId: source.id, elementId: button.id, propPath: "label" })]?.blueprintId).toBe(valueBlueprintId);
        expect(blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "componentWidgetMain", componentId: component.id, elementId: component.rootElementId })]?.blueprintId)
            .toBe(componentBlueprintId);
        expect(Object.keys(blueprintDocument.ownerRecords).filter(key => key.startsWith("componentWidgetMain:")))
            .toEqual([encodeBlueprintOwnerKey({ kind: "componentWidgetMain", componentId: component.id, elementId: component.rootElementId })]);

        const duplicatedSurfaceBlueprint = blueprintDocument.blueprints[duplicatedSurfaceBlueprintId];
        expect(duplicatedSurfaceBlueprint.owner).toEqual({ kind: "surfaceMain", surfaceId: duplicated.id });
        expect(duplicatedSurfaceBlueprint.bindings["bind-surface"].target).toMatchObject({
            surfaceId: duplicated.id,
            elementId: duplicatedButton.id,
        });
        expect(duplicatedSurfaceBlueprint.bindings["bind-surface"].source.blueprintId).toBe(duplicatedSurfaceBlueprintId);
        expect(duplicatedSurfaceBlueprint.graphs.events.init.graph.nodes["node-self"].params).toMatchObject({
            surfaceId: duplicated.id,
            targetSurfaceId: duplicated.id,
            elementId: duplicatedButton.id,
            blueprintId: duplicatedSurfaceBlueprintId,
        });

        const duplicatedWidgetBlueprint = blueprintDocument.blueprints[duplicatedWidgetBlueprintId];
        expect(duplicatedWidgetBlueprint.owner).toEqual({
            kind: "widgetMain",
            surfaceId: duplicated.id,
            elementId: duplicatedButton.id,
        });
        expect(duplicatedWidgetBlueprint.bindings["bind-widget"].target).toMatchObject({
            surfaceId: duplicated.id,
            elementId: duplicatedButton.id,
        });
        expect(duplicatedWidgetBlueprint.bindings["bind-widget"].source.blueprintId).toBe(duplicatedWidgetBlueprintId);
        expect(duplicatedWidgetBlueprint.graphs.events.click.graph.nodes["node-target"].params).toMatchObject({
            surfaceId: duplicated.id,
            elementId: duplicatedLabel.id,
            blueprintId: duplicatedWidgetBlueprintId,
        });

        const duplicatedValueBlueprint = blueprintDocument.blueprints[duplicatedValueBlueprintId];
        expect(duplicatedValueBlueprint.owner).toEqual({
            kind: "widgetValue",
            surfaceId: duplicated.id,
            elementId: duplicatedButton.id,
            propPath: "label",
        });
    });
});

describe("UIDocumentService component library", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("keeps linked instances layout-only and materializes them on unlink", () => {
        const { service } = createHarness();
        const doc = service.getDocument();
        const surface = doc.surfaces[0]!;
        const rootId = surface.rootElementId;

        const button: UIElement = {
            id: "button",
            type: "nl.button",
            name: "CTA Source",
            parentId: rootId,
            childrenIds: ["text"],
            layout: { x: 10, y: 20, width: 120, height: 44 },
            props: { label: "Main CTA" },
        };
        const text: UIElement = {
            id: "text",
            type: "nl.text",
            name: "Label",
            parentId: button.id,
            childrenIds: [],
            layout: { x: 8, y: 8, width: 80, height: 20 },
        };
        doc.elements[rootId]!.childrenIds.push(button.id);
        doc.elements[button.id] = button;
        doc.elements[text.id] = text;
        const component = service.createComponentFromElements(surface.id, [button.id], "CTA")!;

        const instance = service.createComponentInstance(rootId, component.id, {
            x: 300,
            y: 50,
            width: 180,
            height: 64,
        });
        expect(getUIComponentLink(service.getDocument().elements[instance.id])).toEqual({
            componentId: component.id,
            linked: true,
        });

        service.updateElementLayout(instance.id, {
            x: 320,
            opacity: 0.25,
            visible: false,
            lockAspectRatio: true,
        });
        service.updateElementProps(instance.id, { label: "Override" });
        service.updateElementExtra(instance.id, { custom: true });
        service.renameElement(instance.id, "Renamed Instance");

        const linked = service.getDocument().elements[instance.id]!;
        expect(linked.layout.x).toBe(320);
        expect(linked.layout.opacity).toBe(1);
        expect(linked.layout.visible).toBe(true);
        expect(linked.layout.lockAspectRatio).toBeUndefined();
        expect(linked.props).toBeUndefined();
        expect(linked.name).toBe("CTA");
        expect(linked.extra).toEqual({ componentLink: { componentId: component.id, linked: true } });
        expect(() =>
            service.ensureElementBlueprintValueBinding(instance.id, "label", { valueType: "string" }),
        ).toThrow(/Linked component instances/);

        const materializedIds = service.unlinkComponentInstance(instance.id);
        const materializedRoot = service.getDocument().elements[instance.id]!;
        expect(materializedIds).toContain(instance.id);
        expect(materializedIds.length).toBe(2);
        expect(getUIComponentLink(materializedRoot)).toBeNull();
        expect(materializedRoot.layout).toMatchObject({ x: 320, y: 50, width: 180, height: 64 });
        expect(materializedRoot.props).toMatchObject({ label: "Main CTA" });
        expect(materializedRoot.childrenIds).toHaveLength(1);
        expect(materializedRoot.childrenIds[0]).not.toBe(text.id);
    });

    /**
     * What the two inspector halves rely on. The declare side replaces the whole list on every
     * keystroke, so the questions are all about what survives that replacement.
     */
    it("keeps instance values pointed across a rename and a removal", () => {
        const { service } = createHarness();
        const doc = service.getDocument();
        const surface = doc.surfaces[0]!;
        const rootId = surface.rootElementId;
        const source: UIElement = {
            id: "slot-source",
            type: "nl.container",
            name: "Slot",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 60 },
        };
        doc.elements[rootId]!.childrenIds.push(source.id);
        doc.elements[source.id] = source;
        const component = service.createComponentFromElements(surface.id, [source.id], "Save Slot")!;
        const instance = service.createComponentInstance(rootId, component.id, {});

        service.setComponentParams(component.id, [
            { id: "saveId", name: "Save id", type: "string", defaultValue: "1" },
            { id: "label", name: "Label", type: "string", defaultValue: "Empty" },
        ]);
        service.setComponentInstanceParam(instance.id, "saveId", "7");
        // An empty override is a value, not a reset - it has to be stored, or an author could not
        // say "blank" for a param whose default is not.
        service.setComponentInstanceParam(instance.id, "label", "");
        expect(getUIComponentLink(service.getDocument().elements[instance.id])?.params)
            .toEqual({ saveId: "7", label: "" });

        // Only `name` changes: identity is `id`, so nothing the instance stored is unpointed.
        service.setComponentParams(component.id, [
            { id: "saveId", name: "Which save", type: "string", defaultValue: "1" },
            { id: "label", name: "Label", type: "string", defaultValue: "Empty" },
        ]);
        expect(getUIComponentLink(service.getDocument().elements[instance.id])?.params)
            .toEqual({ saveId: "7", label: "" });

        // Removing a param leaves its instance values alone, so re-adding the same id is how an
        // author undoes the deletion. Sweeping here would make a stray click a silent data loss.
        service.setComponentParams(component.id, [
            { id: "label", name: "Label", type: "string", defaultValue: "Empty" },
        ]);
        service.setComponentParams(component.id, [
            { id: "saveId", name: "Save id", type: "string", defaultValue: "1" },
            { id: "label", name: "Label", type: "string", defaultValue: "Empty" },
        ]);
        expect(getUIComponentLink(service.getDocument().elements[instance.id])?.params)
            .toEqual({ saveId: "7", label: "" });
    });

    // A component that arrives inert is worth placing once, which is why every component in the
    // bundled template had exactly one instance. Extraction now carries the logic across, remapped so
    // it drives the copy rather than the elements still sitting on the surface.
    it("carries a widget blueprint into the component it extracts", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });
        const surface = service.createSurface({ kind: "appSurface", host: "app", name: "Save" });
        const doc = service.getDocument();
        const rootId = surface.rootElementId;
        const hit: UIElement = {
            id: "hit-area",
            type: "nl.container",
            name: "Hit area",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 60 },
        } as unknown as UIElement;
        doc.elements[rootId]!.childrenIds.push(hit.id);
        doc.elements[hit.id] = hit;

        blueprintDocument.blueprints["bp-hit"] = {
            id: "bp-hit",
            name: "Hit area",
            owner: { kind: "widgetMain", surfaceId: surface.id, elementId: hit.id },
            members: { variables: {}, fields: {}, functions: {} },
            bindings: {},
            graphs: {
                events: {
                    click: {
                        id: "click",
                        graph: {
                            nodes: {
                                ref: {
                                    id: "ref",
                                    type: "blueprint.element.ref",
                                    params: { surfaceId: surface.id, elementId: hit.id, elementType: "nl.container" },
                                },
                            },
                            edges: [],
                        },
                    },
                },
                functions: {},
            },
        } as never;
        blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: surface.id, elementId: hit.id })] = {
            blueprintId: "bp-hit",
        } as never;

        const component = service.createComponentFromElements(surface.id, [hit.id], "Save slot")!;
        const copy = component.elements[component.rootElementId]!;

        // The blueprint follows the element into the component, as a clone rather than the original:
        // an owner record still naming `bp-hit` would run the surface's blueprint from inside the
        // component and drive the element still out there.
        const boundId = blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "componentWidgetMain", componentId: component.id, elementId: copy.id })]?.blueprintId;
        expect(boundId).toBeTruthy();
        expect(boundId).not.toBe("bp-hit");

        const cloned = blueprintDocument.blueprints[boundId!]!;
        expect(cloned.owner).toMatchObject({ kind: "componentWidgetMain", componentId: component.id, elementId: copy.id });

        // The whole point of the remap: an element ref inside the clone points at the component's
        // copy. Left alone it would reach back out and drive the element still on the surface.
        const refParams = (cloned as never as {
            graphs: { events: Record<string, { graph: { nodes: Record<string, { params: Record<string, string> }> } }> };
        }).graphs.events.click.graph.nodes.ref.params;
        expect(refParams.elementId).toBe(copy.id);
        expect(refParams.elementId).not.toBe(hit.id);

        // The original is untouched: extraction copies into the library, it does not move.
        expect(service.getDocument().elements[hit.id]).toBeTruthy();
        expect(blueprintDocument.blueprints["bp-hit"]).toBeTruthy();

        // Exactly one clone. Selecting an element is enough to give it a blueprint, so most elements
        // own an empty one; carrying those put a shell in the library for every box in the selection.
        const clones = Object.values(blueprintDocument.blueprints).filter(
            b => (b as { owner?: { kind?: string; componentId?: string } }).owner?.kind === "componentWidgetMain"
                && (b as { owner?: { componentId?: string } }).owner?.componentId === component.id,
        );
        expect(clones).toHaveLength(1);
    });

    it("leaves an empty blueprint behind when it extracts", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });
        const surface = service.createSurface({ kind: "appSurface", host: "app", name: "Save" });
        const doc = service.getDocument();
        const rootId = surface.rootElementId;
        const box: UIElement = {
            id: "plain-box",
            type: "nl.container",
            name: "Box",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 40, height: 40 },
        };
        doc.elements[rootId]!.childrenIds.push(box.id);
        doc.elements[box.id] = box;
        blueprintDocument.blueprints["bp-empty"] = {
            id: "bp-empty",
            name: "Box",
            owner: { kind: "widgetMain", surfaceId: surface.id, elementId: box.id },
            members: { variables: {}, fields: {}, functions: {} },
            bindings: {},
            graphs: { events: { click: { id: "click", graph: { nodes: {}, edges: [] } } }, functions: {} },
        } as never;
        blueprintDocument.ownerRecords[encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId: surface.id, elementId: box.id })] = {
            blueprintId: "bp-empty",
        } as never;

        const component = service.createComponentFromElements(surface.id, [box.id], "Box")!;
        const clones = Object.values(blueprintDocument.blueprints).filter(
            b => (b as { owner?: { kind?: string; componentId?: string } }).owner?.kind === "componentWidgetMain"
                && (b as { owner?: { componentId?: string } }).owner?.componentId === component.id,
        );
        expect(clones).toHaveLength(0);
    });

    it("wraps multi-selection components in a relative container root", () => {
        const { service } = createHarness();
        const doc = service.getDocument();
        const surface = doc.surfaces[0]!;
        const rootId = surface.rootElementId;
        const first: UIElement = {
            id: "first",
            type: "nl.container",
            name: "First",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 20, y: 30, width: 100, height: 40 },
        };
        const second: UIElement = {
            id: "second",
            type: "nl.text",
            name: "Second",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 170, y: 90, width: 80, height: 24 },
        };
        doc.elements[rootId]!.childrenIds.push(first.id, second.id);
        doc.elements[first.id] = first;
        doc.elements[second.id] = second;

        const component = service.createComponentFromElements(surface.id, [first.id, second.id], "Group")!;
        const componentRoot = component.elements[component.rootElementId]!;
        const componentChildren = componentRoot.childrenIds.map(id => component.elements[id]!);

        expect(componentRoot.type).toBe("nl.container");
        expect(componentRoot.layout).toMatchObject({ x: 0, y: 0, width: 230, height: 84 });
        expect(componentChildren.map(element => element.type)).toEqual(["nl.container", "nl.text"]);
        expect(componentChildren[0].layout).toMatchObject({ x: 0, y: 0 });
        expect(componentChildren[1].layout).toMatchObject({ x: 150, y: 60 });
    });
});

describe("UIDocumentService template import: components and naming", () => {
    /**
     * A template that ships one library component plus a Page whose element is an
     * instance of it - the shape a component-set template has.
     */
    function createComponentTemplate(): UIDocument {
        return {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "tpl-doc",
            name: "Template",
            surfaces: [
                {
                    id: "tpl-surface",
                    name: "Menu",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: "tpl-root",
                },
            ],
            components: [
                {
                    id: "tpl-component",
                    name: "Primary Button",
                    rootElementId: "tpl-component-root",
                    elements: {
                        "tpl-component-root": {
                            id: "tpl-component-root",
                            type: "nl.container",
                            name: "Button",
                            parentId: null,
                            childrenIds: ["tpl-component-label"],
                            layout: { x: 0, y: 0, width: 200, height: 48 },
                        },
                        "tpl-component-label": {
                            id: "tpl-component-label",
                            type: "nl.text",
                            name: "Label",
                            parentId: "tpl-component-root",
                            childrenIds: [],
                            layout: { x: 0, y: 0, width: 200, height: 48 },
                        },
                    },
                },
            ],
            elements: {
                "tpl-root": {
                    id: "tpl-root",
                    type: "nl.root",
                    name: "Root",
                    parentId: null,
                    childrenIds: ["tpl-instance"],
                    layout: { x: 0, y: 0, width: 1280, height: 720 },
                },
                "tpl-instance": {
                    id: "tpl-instance",
                    type: "nl.container",
                    name: "Start",
                    parentId: "tpl-root",
                    childrenIds: [],
                    layout: { x: 100, y: 200, width: 200, height: 48 },
                    extra: { componentLink: { componentId: "tpl-component", linked: true } },
                },
            },
        } as UIDocument;
    }

    it("copies a template's components into the library under fresh ids", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        expect(result.importedComponents).toHaveLength(1);
        const imported = result.importedComponents[0]!;
        // The library entry exists, is not the template's own id, and kept its elements.
        expect(service.getDocument().components?.map(component => component.id)).toContain(imported.id);
        expect(imported.id).not.toBe("tpl-component");
        expect(Object.keys(imported.elements)).toHaveLength(2);
        expect(Object.keys(imported.elements)).not.toContain("tpl-component-root");
        expect(imported.elements[imported.rootElementId]?.parentId).toBeNull();
    });

    it("repoints an imported surface's component instances at the copied component", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        const surface = result.importedSurfaces[0]!;
        const document = service.getDocument();
        const instance = Object.values(document.elements).find(
            element => element.parentId === surface.rootElementId,
        );
        // Before component import existed this link dangled at "tpl-component",
        // which is an id no project ever holds.
        expect(getUIComponentLink(instance)?.componentId).toBe(result.importedComponents[0]!.id);
    });

    it("keeps template names as authored rather than naming them copies", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        expect(result.importedSurfaces[0]?.name).toBe("Menu");
        expect(result.importedComponents[0]?.name).toBe("Primary Button");
    });

    it("suffixes only on a real collision with something already in the project", () => {
        const { service } = createHarness();

        service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });
        const second = service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        expect(second.importedSurfaces[0]?.name).toBe("Menu 2");
        expect(second.importedComponents[0]?.name).toBe("Primary Button 2");
    });

    it("clones a component's own blueprints onto the copied component", () => {
        const { service, blueprintDocument } = createHarness({ withLocalBlueprint: true });
        const graphs = {
            blueprintDocument: {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                blueprints: {
                    "tpl-bp": {
                        id: "tpl-bp",
                        name: "On click",
                        owner: {
                            kind: "componentWidgetMain",
                            componentId: "tpl-component",
                            elementId: "tpl-component-root",
                        },
                        graphs: { events: {}, functions: {} },
                        members: { variables: {}, fields: {}, functions: {} },
                        bindings: {},
                    },
                },
                ownerRecords: {
                    "componentWidgetMain:tpl-component:tpl-component-root": {
                        blueprintId: "tpl-bp",
                    },
                },
                persistentVariables: {},
                meta: {},
            },
        };

        const result = service.importTemplateBundle({
            document: createComponentTemplate(),
            graphs,
            placement: { kind: "appSurface" },
        });

        const imported = result.importedComponents[0]!;
        const cloned = Object.values<any>(blueprintDocument.blueprints).find(
            blueprint => blueprint.owner.kind === "componentWidgetMain"
                && blueprint.owner.componentId === imported.id,
        );
        expect(cloned).toBeDefined();
        expect(cloned.id).not.toBe("tpl-bp");
        // The owner must point at the copied element, not the template's element id.
        expect(Object.keys(imported.elements)).toContain(cloned.owner.elementId);
    });
});

describe("UIDocumentService template import: multi-surface templates", () => {
    /** Two Pages, the first embedding the second through an nl.frame. */
    function createFramedTemplate(): UIDocument {
        return {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "tpl-framed",
            name: "Config",
            surfaces: [
                {
                    id: "tpl-shell",
                    name: "Config",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: "tpl-shell-root",
                },
                {
                    id: "tpl-pane",
                    name: "Config Â· Sound",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 1280, height: 720 },
                    rootElementId: "tpl-pane-root",
                },
            ],
            elements: {
                "tpl-shell-root": {
                    id: "tpl-shell-root",
                    type: "nl.root",
                    name: "Root",
                    parentId: null,
                    childrenIds: ["tpl-frame"],
                    layout: { x: 0, y: 0, width: 1280, height: 720 },
                },
                "tpl-frame": {
                    id: "tpl-frame",
                    type: "nl.frame",
                    name: "Pane",
                    parentId: "tpl-shell-root",
                    childrenIds: [],
                    layout: { x: 320, y: 0, width: 960, height: 720 },
                    props: { targetSurfaceId: "tpl-pane" },
                },
                "tpl-pane-root": {
                    id: "tpl-pane-root",
                    type: "nl.root",
                    name: "Root",
                    parentId: null,
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 1280, height: 720 },
                },
            },
        } as UIDocument;
    }

    it("repoints a frame at the sibling surface that arrived with it", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: createFramedTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        expect(result.importedSurfaces).toHaveLength(2);
        const pane = result.importedSurfaces.find(surface => surface.name.startsWith("Config Â·"))!;
        const frame = Object.values(service.getDocument().elements)
            .find(element => element.type === "nl.frame")!;

        // Before this was fixed the frame kept "tpl-pane" â€” the template's own id,
        // which no project holds â€” and the pane rendered as an empty box.
        expect((frame.props as { targetSurfaceId?: string }).targetSurfaceId).toBe(pane.id);
        expect((frame.props as { targetSurfaceId?: string }).targetSurfaceId).not.toBe("tpl-pane");
    });

    it("gives each surface of a multi-surface template its own fresh id", () => {
        const { service } = createHarness();

        const result = service.importTemplateBundle({
            document: createFramedTemplate(),
            graphs: undefined,
            placement: { kind: "appSurface" },
        });

        const ids = result.importedSurfaces.map(surface => surface.id);
        expect(new Set(ids).size).toBe(2);
        expect(ids).not.toContain("tpl-shell");
        expect(ids).not.toContain("tpl-pane");
    });
});

describe("UIDocumentService input actions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("mints a vocabulary entry with no bindings of its own", () => {
        const { service } = createHarness();

        const action = service.createInputAction("  Advance  ");

        expect(action).toMatchObject({ name: "Advance", bindings: [] });
        expect(service.getInputActions()[action!.id]).toEqual(action);
        // A default guessed here would wire a gesture into every interface at once.
        expect(action!.bindings).toEqual([]);
    });

    it("refuses a nameless action", () => {
        const { service } = createHarness();

        expect(service.createInputAction("   ")).toBeNull();
        expect(service.getInputActions()).toEqual({});
    });

    it("renames and rebinds an entry in place, so surfaces keep answering it", () => {
        const { service } = createHarness();
        const action = service.createInputAction("Advance")!;
        const surfaceId = service.getDocument().surfaces[0]!.id;
        service.setSurfaceActionEnabled(surfaceId, action.id, true);

        service.renameInputAction(action.id, "Next line");
        service.setInputActionBindings(action.id, [
            { kind: "pointer", gesture: "click" },
            { kind: "key", key: "esc" },
        ]);

        expect(service.getInputActions()[action.id]).toEqual({
            id: action.id,
            name: "Next line",
            // Stored the way the On Key heads spell it, not the way it was typed.
            bindings: [{ kind: "pointer", gesture: "click" }, { kind: "key", key: "Escape" }],
        });
        expect(service.getDocument().surfaces[0]!.actions).toEqual([{ actionId: action.id }]);
    });

    it("clears every surface's answer when the action is deleted", () => {
        const { service } = createHarness();
        const advance = service.createInputAction("Advance")!;
        const skip = service.createInputAction("Skip")!;
        const first = service.getDocument().surfaces[0]!.id;
        const second = service.createSurface({ kind: "appSurface", host: "app", name: "Settings" }).id;
        for (const surfaceId of [first, second]) {
            service.setSurfaceActionEnabled(surfaceId, advance.id, true);
            service.setSurfaceActionEnabled(surfaceId, skip.id, true);
        }

        service.deleteInputAction(advance.id);

        const document = service.getDocument();
        expect(document.actions).toEqual({ [skip.id]: skip });
        for (const surface of document.surfaces) {
            expect(surface.actions).toEqual([{ actionId: skip.id }]);
        }
    });

    it("records the deletion and its pruning as one document mutation", () => {
        const { service } = createHarness();
        const action = service.createInputAction("Advance")!;
        const surfaceId = service.getDocument().surfaces[0]!.id;
        service.setSurfaceActionEnabled(surfaceId, action.id, true);
        // A surface left answering an action nothing defines must never be observable, not even
        // between two change events.
        const seen: { actions: string[]; enablements: string[] }[] = [];
        const stop = service.onDocumentChanged(document => {
            seen.push({
                actions: Object.keys(document.actions ?? {}),
                enablements: (document.surfaces[0]!.actions ?? []).map(entry => entry.actionId),
            });
        });

        service.deleteInputAction(action.id);
        stop();

        expect(seen).toEqual([{ actions: [], enablements: [] }]);
    });

    it("drops a surface's record when it stops answering, rather than flagging it off", () => {
        const { service } = createHarness();
        const action = service.createInputAction("Advance")!;
        const surfaceId = service.getDocument().surfaces[0]!.id;

        service.setSurfaceActionEnabled(surfaceId, action.id, true);
        service.updateSurfaceActionEnablement(surfaceId, action.id, { consume: false });
        expect(service.getDocument().surfaces[0]!.actions).toEqual([
            { actionId: action.id, consume: false },
        ]);

        service.setSurfaceActionEnabled(surfaceId, action.id, false);

        expect(service.getDocument().surfaces[0]!.actions).toBeUndefined();
    });

    it("clears a field by patching the key to undefined", () => {
        const { service } = createHarness();
        const action = service.createInputAction("Advance")!;
        const surfaceId = service.getDocument().surfaces[0]!.id;
        service.setSurfaceActionEnabled(surfaceId, action.id, true);

        service.updateSurfaceActionEnablement(surfaceId, action.id, { consume: false });
        expect(service.getDocument().surfaces[0]!.actions?.[0]).toEqual({
            actionId: action.id,
            consume: false,
        });

        service.updateSurfaceActionEnablement(surfaceId, action.id, { consume: undefined });
        expect(service.getDocument().surfaces[0]!.actions?.[0]).toEqual({ actionId: action.id });
    });

    it("starts a new action from the bindings a preset laid down", () => {
        const { service } = createHarness();
        const action = service.createInputAction("Back", [{ kind: "key", key: "esc" }])!;

        // Canonicalised on the way in like any other stored binding, and nothing records that a
        // preset was involved.
        expect(action.bindings).toEqual([{ kind: "key", key: "Escape" }]);
    });
});

describe("UIDocumentService input model normalization", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    function migrate(service: UIDocumentService, document: UIDocument): UIDocument {
        return (service as any).migrateIfNeeded(document) as UIDocument;
    }

    it("loads a document written before the input model with sensible defaults", () => {
        const { service, initialDocument } = createHarness();
        const legacy: UIDocument = JSON.parse(JSON.stringify(initialDocument));

        const loaded = migrate(service, legacy);

        expect(loaded.actions).toBeUndefined();
        for (const surface of loaded.surfaces) {
            expect(surface.actions).toBeUndefined();
        }
    });

    it("round-trips a vocabulary and a surface's answers unchanged", () => {
        const { service, initialDocument } = createHarness();
        const stored: UIDocument = {
            ...JSON.parse(JSON.stringify(initialDocument)),
            actions: {
                advance: { id: "advance", name: "Advance", bindings: [{ kind: "pointer", gesture: "click" }] },
            },
        };
        stored.surfaces[0]!.actions = [{ actionId: "advance", consume: false }];
        const before = JSON.stringify(stored);

        const loaded = migrate(service, JSON.parse(before) as UIDocument);

        expect(JSON.stringify(loaded)).toBe(before);
    });

    it("repairs a stored vocabulary this build cannot read as written", () => {
        const { service, initialDocument } = createHarness();
        const stored: UIDocument = {
            ...JSON.parse(JSON.stringify(initialDocument)),
            actions: {
                // Key and id have drifted apart; the key is what surfaces store, so it wins.
                advance: { id: "renamed", name: "Advance", bindings: [{ kind: "key", key: "esc" }] },
                broken: { name: "No id", bindings: [] },
            } as any,
        };
        stored.surfaces[0]!.actions = [{ actionId: "advance" }, { actionId: "" }] as any;

        const loaded = migrate(service, stored);

        expect(loaded.actions).toEqual({
            advance: { id: "advance", name: "Advance", bindings: [{ kind: "key", key: "Escape" }] },
        });
        expect(loaded.surfaces[0]!.actions).toEqual([{ actionId: "advance" }]);
    });

    it("v12 gives a surface that changed an action bindings an action of its own", () => {
        const { service, initialDocument } = createHarness();
        const stored: UIDocument = {
            ...JSON.parse(JSON.stringify(initialDocument)),
            schemaVersion: 11 as UIDocument["schemaVersion"],
            actions: {
                dismiss: { id: "dismiss", name: "Dismiss", bindings: [{ kind: "key", key: "Escape" }] },
            },
        };
        stored.surfaces[0]!.actions = [
            {
                actionId: "dismiss",
                addBindings: [{ kind: "pointer", gesture: "wheelDown" }],
                overControls: "fire",
            },
        ] as any;

        const loaded = migrate(service, stored);
        const minted = Object.values(loaded.actions ?? {}).find(entry => entry.id !== "dismiss");

        // The gestures the surface actually used survive, under a name that says where they came
        // from. Dropping the record without this would leave a page closing on nothing.
        expect(minted?.bindings).toEqual([
            { kind: "key", key: "Escape" },
            { kind: "pointer", gesture: "wheelDown" },
        ]);
        expect(loaded.surfaces[0]!.actions).toEqual([{ actionId: minted!.id }]);
        expect(loaded.actions?.dismiss?.bindings).toEqual([{ kind: "key", key: "Escape" }]);
    });

    /**
     * The walk, not the fold - `legacyImageProps.test.ts` covers what one element becomes. What is
     * asserted here is that a component definition is reached: its elements are the same elements
     * with a different owner, and one authored before the current shape would otherwise keep the old
     * keys wherever it was placed.
     */
    it("folds the pre-imageFill shape on surfaces and inside component definitions alike", () => {
        const { service, initialDocument } = createHarness();
        const stored: UIDocument = JSON.parse(JSON.stringify(initialDocument));
        stored.elements["on-page"] = {
            id: "on-page",
            type: "nl.image",
            parentId: stored.surfaces[0]!.rootElementId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 10, height: 10 },
            props: { assetId: "art-1" },
        };
        stored.components = [{
            id: "component-1",
            name: "Card",
            rootElementId: "in-component",
            elements: {
                "in-component": {
                    id: "in-component",
                    type: "nl.image",
                    parentId: null,
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 10, height: 10 },
                    props: { assetId: "art-2" },
                },
            },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }] as UIDocument["components"];

        const loaded = migrate(service, stored);

        expect(loaded.elements["on-page"]!.props).toEqual({
            fillType: "image",
            imageFill: { mode: "cover", assetId: "art-1" },
        });
        expect(loaded.components![0]!.elements["in-component"]!.props).toEqual({
            fillType: "image",
            imageFill: { mode: "cover", assetId: "art-2" },
        });
    });

    it("v12 leaves an override that worked out to the project own bindings alone", () => {
        const { service, initialDocument } = createHarness();
        const stored: UIDocument = {
            ...JSON.parse(JSON.stringify(initialDocument)),
            schemaVersion: 11 as UIDocument["schemaVersion"],
            actions: {
                advance: { id: "advance", name: "Advance", bindings: [{ kind: "pointer", gesture: "click" }] },
            },
        };
        stored.surfaces[0]!.actions = [
            { actionId: "advance", overrideBindings: [{ kind: "pointer", gesture: "click" }] },
        ] as any;

        const loaded = migrate(service, stored);

        expect(Object.keys(loaded.actions ?? {})).toEqual(["advance"]);
        expect(loaded.surfaces[0]!.actions).toEqual([{ actionId: "advance" }]);
    });
});

/**
 * Reordering the surface list is the panel's drag, and the only edit this service puts on the
 * workspace-wide stack: it belongs to no single surface, so the editor's own per-surface history has
 * nowhere to hold it.
 */
describe("UIDocumentService.reorderSurfaces", () => {
    const names = (service: UIDocumentService) => service.getDocument().surfaces.map(surface => surface.name);

    function seedPages(service: UIDocumentService) {
        service.createSurface({ kind: "appSurface", host: "app", name: "Second" });
        service.createSurface({ kind: "appSurface", host: "app", name: "Third" });
    }

    it("puts the surfaces in the order given", () => {
        const { service } = createHarness();
        seedPages(service);
        const [main, second, third] = service.getDocument().surfaces.map(surface => surface.id);
        const mainName = names(service)[0];

        service.reorderSurfaces([third, main, second]);

        expect(names(service)).toEqual(["Third", mainName, "Second"]);
    });

    it("keeps a surface the order does not name rather than dropping it", () => {
        const { service } = createHarness();
        seedPages(service);
        const ids = service.getDocument().surfaces.map(surface => surface.id);

        // A stale order, written before "Third" existed. It states position, never deletion.
        service.reorderSurfaces([ids[1], ids[0]]);

        expect(service.getDocument().surfaces.map(surface => surface.id)).toEqual([ids[1], ids[0], ids[2]]);
    });

    it("undoes and redoes the move on the project stack", () => {
        const { service, projectHistory } = createHarness();
        seedPages(service);
        const ids = service.getDocument().surfaces.map(surface => surface.id);
        const original = [...ids];
        projectHistory.clearScope(projectHistoryScope());

        service.reorderSurfaces([ids[2], ids[0], ids[1]], ids[2]);
        expect(service.getDocument().surfaces.map(surface => surface.id)).toEqual([ids[2], ids[0], ids[1]]);

        expect(projectHistory.undo(projectHistoryScope())).toBe(true);
        expect(service.getDocument().surfaces.map(surface => surface.id)).toEqual(original);
        expect(projectHistory.redo(projectHistoryScope())).toBe(true);
        expect(service.getDocument().surfaces.map(surface => surface.id)).toEqual([ids[2], ids[0], ids[1]]);
    });

    it("names the step after the surface that moved", () => {
        const { service, projectHistory } = createHarness();
        seedPages(service);
        const ids = service.getDocument().surfaces.map(surface => surface.id);
        projectHistory.clearScope(projectHistoryScope());

        service.reorderSurfaces([ids[2], ids[0], ids[1]], ids[2]);

        expect(projectHistory.peekUndo(projectHistoryScope())).toEqual({
            key: "uiEditor.history.moveSurface",
            params: { name: "Third" },
        });
    });

    it("records nothing when the order it is handed is the order it already has", () => {
        const { service, projectHistory } = createHarness();
        seedPages(service);
        const ids = service.getDocument().surfaces.map(surface => surface.id);
        projectHistory.clearScope(projectHistoryScope());

        service.reorderSurfaces(ids, ids[0]);

        expect(projectHistory.canUndo(projectHistoryScope())).toBe(false);
    });
});
