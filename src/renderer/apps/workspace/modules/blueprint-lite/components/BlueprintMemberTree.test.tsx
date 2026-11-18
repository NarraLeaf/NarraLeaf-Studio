// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { GLOBAL_MAIN_OWNER_KEY } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { BlueprintMemberTree } from "./BlueprintMemberTree";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string, params?: { count?: number }) => params?.count === undefined ? key : `${key}:${params.count}`, tn: (key: string) => key, has: () => false, locale: "en" }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, writes: () => ({}), menuRow: () => ({}) }),
}));
vi.mock("@/apps/workspace/context", () => {
    const service = { onRegistryChanged: () => () => undefined };
    const context = { services: { get: () => service } };
    return { useWorkspace: () => ({ context, isInitialized: true }) };
});
vi.mock("./BlueprintLiteralValueControl", () => ({ BlueprintLiteralValueControl: () => null }));

afterEach(cleanup);

describe("blueprint variable names", () => {
    it.each(["global", "persistent"] as const)("cancels a %s variable rename with Escape", kind => {
        const blueprint = {
            id: "global", owner: { kind: "globalMain" },
            graphs: { events: {}, eventIds: [], functions: {} },
            members: { variables: { variable: { id: "variable", name: "Global name", valueType: "string", defaultValue: "" } }, fields: {}, functions: {} },
        } as unknown as Blueprint;
        const renameBlueprintVariable = vi.fn();
        const renamePersistentVariable = vi.fn();
        const localBp = {
            getBlueprintDocument: () => ({ ownerRecords: { [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: "global" } }, blueprints: { global: blueprint } }),
            listPersistentVariables: () => [{ id: "persistent", name: "Persistent name", valueType: "string", defaultValue: "" }],
            renameBlueprintVariable,
            renamePersistentVariable,
        } as unknown as LocalBlueprintService;
        render(<BlueprintMemberTree blueprint={blueprint} blueprintId="global" blueprintDocumentRevision={0} graphView={null} diagnostics={[]} localBp={localBp} variableGroupOpenState={{ global: true, persistent: true }} onSelectLayer={() => undefined} onAddLayer={() => undefined} onDeleteLayer={() => undefined} />);
        const input = screen.getByDisplayValue(kind === "global" ? "Global name" : "Persistent name") as HTMLInputElement;
        act(() => input.focus());
        fireEvent.change(input, { target: { value: "Changed name" } });
        fireEvent.keyDown(input, { key: "Escape" });
        expect(renameBlueprintVariable).not.toHaveBeenCalled();
        expect(renamePersistentVariable).not.toHaveBeenCalled();
        expect(input.value).toBe(kind === "global" ? "Global name" : "Persistent name");
        act(() => input.focus());
        fireEvent.change(input, { target: { value: "Accepted name" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(kind === "global" ? renameBlueprintVariable : renamePersistentVariable)
            .toHaveBeenCalledWith("global", kind === "global" ? "variable" : "persistent", "Accepted name");
    });
});

describe("blueprint layer diagnostics", () => {
    it("counts node diagnostics on the layer that contains them", () => {
        const blueprint = {
            id: "global", owner: { kind: "globalMain" },
            graphs: { events: { first: { id: "first", name: "Layer" } }, eventIds: ["first"], functions: {} },
            members: { variables: {}, fields: {}, functions: {} },
        } as unknown as Blueprint;
        const localBp = {
            getBlueprintDocument: () => ({ ownerRecords: {}, blueprints: { global: blueprint } }),
            listPersistentVariables: () => [],
        } as unknown as LocalBlueprintService;
        render(<BlueprintMemberTree blueprint={blueprint} blueprintId="global" blueprintDocumentRevision={0} graphView={null}
            diagnostics={[
                { severity: "error", message: "Missing output", target: { kind: "node", graphKind: "event", graphId: "first", nodeId: "node" } },
                { severity: "error", message: "Other layer", target: { kind: "node", graphKind: "event", graphId: "second", nodeId: "node" } },
            ]} localBp={localBp} onSelectLayer={() => undefined} onAddLayer={() => undefined} onDeleteLayer={() => undefined} />);
        expect(screen.getByText("blueprint.memberTree.errorBadge:1")).not.toBeNull();
    });
});
