import { describe, expect, it } from "vitest";
import { BoundedBufferCache } from "./runtimeResources";

describe("BoundedBufferCache", () => {
    it("evicts the least recently used entries once over budget", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(4));
        cache.set("b", Buffer.alloc(4));
        // Touch "a" so "b" becomes the eviction candidate.
        expect(cache.get("a")).not.toBeNull();
        cache.set("c", Buffer.alloc(4));

        expect(cache.get("b")).toBeNull();
        expect(cache.get("a")).not.toBeNull();
        expect(cache.get("c")).not.toBeNull();
    });

    it("replaces entries in place and rejects oversized values", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(6));
        cache.set("a", Buffer.alloc(8));
        expect(cache.get("a")?.byteLength).toBe(8);

        cache.set("big", Buffer.alloc(11));
        expect(cache.get("big")).toBeNull();
        // The oversized value must not have evicted the existing entry.
        expect(cache.get("a")?.byteLength).toBe(8);
    });

    it("clear drops everything", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(2));
        cache.clear();
        expect(cache.get("a")).toBeNull();
    });
});
