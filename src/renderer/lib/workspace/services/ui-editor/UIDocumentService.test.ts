import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import {
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
    BLUEPRINT_NODE_TYPE_GAME_NEXT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
} from "@shared/types/blueprint/graph";

function ownerKeyForTest(owner: BlueprintOwnerRef): string {
    switch (owner.kind) {
        case "globalMain":
            return "globalMain";
        case "surfaceMain":
            return `surfaceMain:${owner.surfaceId}`;
        case "widgetMain":
            return `widgetMain:${owner.surfaceId}:${owner.elementId}`;
        case "widgetValue":
            return `widgetValue:${owner.surfaceId}:${owner.elementId}:${encodeURIComponent(owner.propPath)}`;
        case "componentWidgetMain":
            return `componentWidgetMain:${owner.componentId}:${owner.elementId}`;
        case "sharedAsset":
            return `sharedAsset:${owner.assetId}`;
        default: {
            const _exhaustive: never = owner;
            return _exhaustive;
        }
    }
}

function createHarness(options: { withLocalBlueprint?: boolean } = {}) {
    let nextId = 0;
    const service = new UIDocumentService();
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
            frontend: "visual",
            programKind: "graph",
            program: {
                kind: "graph",
                graphs: {
                    events: {},
                    functions: {},
                },
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
            activeBlueprintId: id,
            privateBlueprintIds: prev?.privateBlueprintIds?.includes(id)
                ? prev.privateBlueprintIds
                : [...(prev?.privateBlueprintIds ?? []), id],
            initializedFrontend: prev?.initializedFrontend ?? "visual",
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
            blueprint.program.graphs.events.init = blueprint.program.graphs.events.init ?? {
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
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });

    const initialDocument = (service as any).createEmptyDocument();
    (service as any).document = initialDocument;

    return { service, initialDocument, blueprintDocument, createGraphBlueprint };
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
        expect(interactionLayer.props?.appearance).toBeTruthy();
        expect(panel.props?.appearance).toBeTruthy();
        expect(stack.props?.appearance).toBeTruthy();
        expect(nametag.props?.appearance).toBeTruthy();
        expect(sentence.props?.appearance).toBeTruthy();
    });

    it("wires default Dialog template blueprints for Next and Nametag updates", () => {
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
        const nametag = doc.elements[stack.childrenIds[0]!]!;
        const sentence = doc.elements[stack.childrenIds[1]!]!;

        expect(interactionLayer.behavior?.events?.mouseClick).toBeUndefined();
        expect(interactionLayer.behavior?.events?.keyUp).toBeUndefined();

        expect(blueprintDocument.blueprints[`widget-main-${panel.id}`]).toBeUndefined();
        const contentBlueprint = blueprintDocument.blueprints[`widget-main-${stack.id}`];
        expect(contentBlueprint.owner).toMatchObject({ kind: "widgetMain", elementId: stack.id });
        expect(Object.keys(contentBlueprint.program.graphs.events)).toEqual(["dialogNext"]);
        const nextGraph = contentBlueprint.program.graphs.events.dialogNext.graph;
        const nextNodes = Object.values(nextGraph.nodes) as any[];
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK)).toBe(true);
        const elementClickTargets = nextNodes
            .filter((node: any) => node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)
            .map((node: any) => [node.params?.elementId, node.params?.elementType]);
        expect(elementClickTargets).toHaveLength(4);
        expect(elementClickTargets).toEqual(expect.arrayContaining([
            [interactionLayer.id, "nl.container"],
            [panel.id, "nl.container"],
            [nametag.id, "nl.text"],
            [sentence.id, "nl.dialog.sentence"],
        ]));
        expect(nextNodes.some((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_NEXT)).toBe(true);
        expect(nextNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP &&
            node.params?.[BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME] === " "
        )).toBe(true);
        const nextIncomingEdges = nextGraph.edges.filter((edge: any) => edge.to.nodeId === "dialog.next" && edge.to.port === "in");
        expect(nextIncomingEdges).toHaveLength(6);
        const outgoingKeys = nextGraph.edges.map((edge: any) => `${edge.from.nodeId}:${edge.from.port}`);
        expect(new Set(outgoingKeys).size).toBe(outgoingKeys.length);

        expect(nametag.valueBindings?.text).toBeUndefined();
        const nametagBlueprint = blueprintDocument.blueprints[`widget-main-${nametag.id}`];
        expect(nametagBlueprint.owner).toMatchObject({ kind: "widgetMain", elementId: nametag.id });
        expect(Object.keys(nametagBlueprint.program.graphs.events)).toEqual(["nametagUpdate"]);
        const nametagGraph = nametagBlueprint.program.graphs.events.nametagUpdate.graph;
        const nametagNodeTypes = new Set(Object.values(nametagGraph.nodes).map((node: any) => node.type));
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)).toBe(true);
        expect(Object.values(nametagGraph.nodes).filter((node: any) => node.type === BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG)).toHaveLength(2);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_DATA_NOT_NULL)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_FLOW_IF)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY)).toBe(true);
        expect(nametagNodeTypes.has(BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT)).toBe(true);
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
        expect(list.props).toMatchObject({ itemKeyPath: "id", itemGap: 12 });
        expect(itemContainer.type).toBe("nl.container");
        expect(itemContainer.extra?.listSlot).toBe("itemTemplate");
        expect(itemText.type).toBe("nl.text");
        expect(itemText.valueBindings?.text).toMatchObject({ kind: "blueprintValue", valueType: "string" });

        const valueBlueprint = blueprintDocument.blueprints[`widget-value-${itemText.id}-text`];
        const valueGraph = valueBlueprint.program.graphs.events.init.graph;
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
        expect(list.props).toMatchObject({ itemKeyPath: "index", itemGap: 16 });
        expect(itemContainer.extra?.listSlot).toBe("itemTemplate");
        expect(itemText.valueBindings?.text).toMatchObject({ kind: "blueprintValue", valueType: "string" });

        const valueBlueprint = blueprintDocument.blueprints[`widget-value-${itemText.id}-text`];
        const valueNodes = Object.values(valueBlueprint.program.graphs.events.init.graph.nodes) as any[];
        expect(valueNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET && node.params?.path === "text"
        )).toBe(true);

        const listBlueprint = blueprintDocument.blueprints[`widget-main-${list.id}`];
        expect(Object.keys(listBlueprint.program.graphs.events)).toEqual(["choiceSelect"]);
        const selectGraph = listBlueprint.program.graphs.events.choiceSelect.graph;
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
        const valueNodes = Object.values(valueBlueprint.program.graphs.events.init.graph.nodes) as any[];
        expect(valueNodes.some((node: any) =>
            node.type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET && node.params?.path === "nametag"
        )).toBe(true);

        // Advancement graph is hosted on the Panel (nl.container) because the NVL List is a
        // collection widget without a Mouse Click head.
        expect(blueprintDocument.blueprints[`widget-main-${list.id}`]).toBeUndefined();
        const panelBlueprint = blueprintDocument.blueprints[`widget-main-${panel.id}`];
        expect(Object.keys(panelBlueprint.program.graphs.events)).toEqual(["nvlNext"]);
        const nextGraph = panelBlueprint.program.graphs.events.nvlNext.graph;
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

    it("migrates legacy stage mounts and slot aliases", () => {
        const { service } = createHarness();
        const base = service.getDocument();
        const migrated = (service as any).migrateIfNeeded({
            ...base,
            schemaVersion: 9,
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
        button.behavior = {
            events: {
                mouseClick: { kind: "blueprintEvent", blueprintId: widgetBlueprintId, eventId: "click" },
            },
        };
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
        surfaceBlueprint.program.graphs.events.init = {
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
        widgetBlueprint.program.graphs.events.click = {
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

        const duplicatedEvent = duplicatedButton.behavior?.events?.mouseClick;
        expect(duplicatedEvent?.kind).toBe("blueprintEvent");
        if (duplicatedEvent?.kind !== "blueprintEvent") {
            throw new Error("Expected duplicated button event blueprint binding");
        }
        const duplicatedWidgetBlueprintId = duplicatedEvent.blueprintId;
        const duplicatedValueBlueprintId = duplicatedButton.valueBindings?.label?.blueprintId;
        const duplicatedSurfaceBlueprintId = blueprintDocument.ownerRecords[`surfaceMain:${duplicated.id}`]?.activeBlueprintId;

        expect(duplicatedSurfaceBlueprintId).toBeTruthy();
        expect(duplicatedSurfaceBlueprintId).not.toBe(surfaceBlueprintId);
        expect(duplicatedWidgetBlueprintId).not.toBe(widgetBlueprintId);
        expect(duplicatedValueBlueprintId).toBeTruthy();
        expect(duplicatedValueBlueprintId).not.toBe(valueBlueprintId);
        if (!duplicatedValueBlueprintId) {
            throw new Error("Expected duplicated value blueprint binding");
        }

        expect(blueprintDocument.ownerRecords[`surfaceMain:${source.id}`]?.activeBlueprintId).toBe(surfaceBlueprintId);
        expect(blueprintDocument.ownerRecords[`widgetMain:${source.id}:${button.id}`]?.activeBlueprintId).toBe(widgetBlueprintId);
        expect(blueprintDocument.ownerRecords[`widgetValue:${source.id}:${button.id}:label`]?.activeBlueprintId).toBe(valueBlueprintId);
        expect(blueprintDocument.ownerRecords[`componentWidgetMain:${component.id}:${component.rootElementId}`]?.activeBlueprintId)
            .toBe(componentBlueprintId);
        expect(Object.keys(blueprintDocument.ownerRecords).filter(key => key.startsWith("componentWidgetMain:")))
            .toEqual([`componentWidgetMain:${component.id}:${component.rootElementId}`]);

        const duplicatedSurfaceBlueprint = blueprintDocument.blueprints[duplicatedSurfaceBlueprintId];
        expect(duplicatedSurfaceBlueprint.owner).toEqual({ kind: "surfaceMain", surfaceId: duplicated.id });
        expect(duplicatedSurfaceBlueprint.bindings["bind-surface"].target).toMatchObject({
            surfaceId: duplicated.id,
            elementId: duplicatedButton.id,
        });
        expect(duplicatedSurfaceBlueprint.bindings["bind-surface"].source.blueprintId).toBe(duplicatedSurfaceBlueprintId);
        expect(duplicatedSurfaceBlueprint.program.graphs.events.init.graph.nodes["node-self"].params).toMatchObject({
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
        expect(duplicatedWidgetBlueprint.program.graphs.events.click.graph.nodes["node-target"].params).toMatchObject({
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
