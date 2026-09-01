import { describe, expect, it, vi } from "vitest";
import { Workspace } from "@/lib/workspace/workspace";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import type { ActionDefinition, ActionGroup, PanelDefinition } from "@/apps/workspace/registry/types";
import {
    guardPluginAction,
    guardPluginActionGroup,
    guardPluginPanel,
    guardWorkspaceContextForPlugin,
    guardWorkspaceForPlugin,
} from "./pluginWorkspaceGuard";

/**
 * A stand-in for the live workspace the app hands a plugin callback. Its registry returns a
 * sentinel for any service, so a test can tell the guarded view (which refuses) apart from the live
 * one (which would return the sentinel - and, in the real app, a default-facade FileSystem).
 */
function fakeLiveContext(): WorkspaceContext {
    const project = { resolve: (...parts: string[]) => parts.join("/") };
    return {
        project: project as unknown as WorkspaceContext["project"],
        services: {
            get: () => "LIVE_SERVICE",
            getAll: () => ["LIVE_SERVICE"],
        } as unknown as WorkspaceContext["services"],
    };
}

function fakeLiveWorkspace(): Workspace {
    return Workspace.create(fakeLiveContext());
}

describe("guardWorkspaceContextForPlugin", () => {
    it("refuses every service registry lookup", () => {
        const guarded = guardWorkspaceContextForPlugin("acme.plugin", fakeLiveContext());

        expect(() => guarded.services.get("fileSystem" as any)).toThrow(/acme\.plugin/);
        expect(() => guarded.services.get("fileSystem" as any)).toThrow(/workspace service registry/);
        expect(() => guarded.services.getAll()).toThrow(/workspace service registry/);
    });

    it("keeps the project path helper reachable, so a plugin can still build a path for app.privileged", () => {
        const live = fakeLiveContext();
        const guarded = guardWorkspaceContextForPlugin("acme.plugin", live);

        expect(guarded.project).toBe(live.project);
    });

    it("holds no reachable reference back to the live registry", () => {
        const guarded = guardWorkspaceContextForPlugin("acme.plugin", fakeLiveContext());

        // The denied registry stands alone: nothing on it (own or inherited) yields the live one.
        for (const key of [...Object.keys(guarded.services), "get", "getAll"]) {
            const value = (guarded.services as any)[key];
            if (typeof value !== "function") {
                expect(value).not.toBe("LIVE_SERVICE");
            }
        }
    });
});

describe("guardWorkspaceForPlugin", () => {
    it("returns a Workspace whose getContext() gives the refusing registry", () => {
        const guarded = guardWorkspaceForPlugin("acme.plugin", fakeLiveWorkspace());

        expect(guarded).toBeInstanceOf(Workspace);
        expect(() => guarded.getContext().services.get("fileSystem" as any)).toThrow(/workspace service registry/);
    });
});

describe("guardPluginAction", () => {
    it("passes the guarded workspace to the plugin's onClick", () => {
        const onClick = vi.fn();
        const action = { id: "acme.plugin.do", onClick } as unknown as ActionDefinition;

        const guarded = guardPluginAction("acme.plugin", action);
        guarded.onClick(fakeLiveWorkspace());

        expect(onClick).toHaveBeenCalledTimes(1);
        const handed = onClick.mock.calls[0][0] as Workspace;
        expect(() => handed.getContext().services.get("fileSystem" as any)).toThrow(/workspace service registry/);
    });

    it("preserves the rest of the action definition", () => {
        const action = { id: "acme.plugin.do", label: "Do", order: 3, onClick: vi.fn() } as unknown as ActionDefinition;

        const guarded = guardPluginAction("acme.plugin", action);

        expect(guarded.id).toBe("acme.plugin.do");
        expect(guarded.label).toBe("Do");
        expect(guarded.order).toBe(3);
    });
});

describe("guardPluginActionGroup", () => {
    it("guards commands in both the flat actions list and the nested items tree", () => {
        const flat = vi.fn();
        const nested = vi.fn();
        const group = {
            id: "acme.plugin.group",
            label: "Group",
            actions: [{ id: "acme.plugin.flat", onClick: flat }, { separator: true }],
            items: [
                {
                    id: "acme.plugin.submenu",
                    label: "More",
                    items: [{ id: "acme.plugin.nested", onClick: nested }],
                },
            ],
        } as unknown as ActionGroup;

        const guarded = guardPluginActionGroup("acme.plugin", group);

        (guarded.actions![0] as ActionDefinition).onClick(fakeLiveWorkspace());
        expect(() => (flat.mock.calls[0][0] as Workspace).getContext().services.get("fileSystem" as any))
            .toThrow(/workspace service registry/);

        const submenu = guarded.items![0] as { items: ActionDefinition[] };
        submenu.items[0].onClick(fakeLiveWorkspace());
        expect(() => (nested.mock.calls[0][0] as Workspace).getContext().services.get("fileSystem" as any))
            .toThrow(/workspace service registry/);
    });
});

describe("guardPluginPanel", () => {
    it("guards railAction and leaves a component-only panel untouched", () => {
        const railAction = vi.fn();
        const panel = { id: "acme.plugin.rail", railAction } as unknown as PanelDefinition;

        const guarded = guardPluginPanel("acme.plugin", panel);
        guarded.railAction!(fakeLiveContext());

        expect(() => (railAction.mock.calls[0][0] as WorkspaceContext).services.get("fileSystem" as any))
            .toThrow(/workspace service registry/);

        const plain = { id: "acme.plugin.body", component: () => null } as unknown as PanelDefinition;
        expect(guardPluginPanel("acme.plugin", plain)).toBe(plain);
    });
});
