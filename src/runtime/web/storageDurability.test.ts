import { describe, expect, it, vi } from "vitest";
import { requestStorageDurability } from "./storageDurability";

describe("requestStorageDurability", () => {
    it("answers durable without asking again when the grant is already held", async () => {
        const persist = vi.fn(async () => true);
        await expect(requestStorageDurability({ persisted: async () => true, persist }))
            .resolves.toBe("durable");
        expect(persist).not.toHaveBeenCalled();
    });

    it("asks for the grant and answers durable when it is given", async () => {
        await expect(requestStorageDurability({ persisted: async () => false, persist: async () => true }))
            .resolves.toBe("durable");
    });

    it("answers evictable when the browser refuses the grant", async () => {
        await expect(requestStorageDurability({ persisted: async () => false, persist: async () => false }))
            .resolves.toBe("evictable");
    });

    it("answers evictable when the state can be read but not asked for", async () => {
        await expect(requestStorageDurability({ persisted: async () => false, persist: null }))
            .resolves.toBe("evictable");
    });

    it("answers unknown in a browser with no Storage API", async () => {
        await expect(requestStorageDurability({ persisted: null, persist: null })).resolves.toBe("unknown");
    });

    it("answers unknown when the call itself is refused", async () => {
        await expect(requestStorageDurability({
            persisted: async () => {
                throw new Error("SecurityError");
            },
            persist: async () => true,
        })).resolves.toBe("unknown");
    });
});
