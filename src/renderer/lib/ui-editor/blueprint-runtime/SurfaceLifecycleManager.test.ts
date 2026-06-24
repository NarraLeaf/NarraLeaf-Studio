import { describe, expect, it } from "vitest";
import { SurfaceLifecycleManager } from "./SurfaceLifecycleManager";

describe("SurfaceLifecycleManager", () => {
    it("dispatches init once per mounted runtime scope", () => {
        const manager = new SurfaceLifecycleManager();

        expect(manager.onSurfaceEnter("page-a:1")).toBe(true);
        expect(manager.onSurfaceEnter("page-a:1")).toBe(false);
        expect(manager.isInitialized("page-a:1")).toBe(true);

        manager.onSurfaceExit("page-a:1");
        expect(manager.isInitialized("page-a:1")).toBe(false);
        expect(manager.onSurfaceEnter("page-a:1")).toBe(true);
    });
});
