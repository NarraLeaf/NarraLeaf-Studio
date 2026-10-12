import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, AGENT_TOOLS_BY_NAME } from "./tools";
import type { AgentJsonSchema } from "./tools";
import { validateAgentArgs } from "./validateArgs";

function errorsOf(schema: AgentJsonSchema, value: unknown): string[] {
    const result = validateAgentArgs(schema, value);
    return result.ok ? [] : result.errors;
}

function tool(name: string) {
    const descriptor = AGENT_TOOLS_BY_NAME.get(name);
    if (!descriptor) {
        throw new Error(`no tool ${name}`);
    }
    return descriptor.inputSchema;
}

describe("validateAgentArgs", () => {
    it("accepts an empty object for a tool with no required arguments", () => {
        expect(validateAgentArgs(tool("agent_status"), {})).toEqual({ ok: true });
    });

    it("refuses arguments that are not an object", () => {
        expect(errorsOf(tool("agent_status"), [])).toEqual(["arguments: expected an object, got an array"]);
        expect(errorsOf(tool("agent_status"), null)).toEqual(["arguments: expected an object, got null"]);
    });

    it("names a missing required argument", () => {
        expect(errorsOf(tool("project_open"), {})).toEqual(["path: required"]);
    });

    it("refuses a value outside an enum and lists the allowed ones", () => {
        const [error] = errorsOf(tool("lint"), { severity: "nope" });
        expect(error).toMatch(/^severity: must be one of "error", "warning", "info"/);
    });

    it("refuses an argument the schema does not declare, naming the ones it does", () => {
        expect(errorsOf(tool("project_open"), { path: "/x", force: true })).toEqual([
            "force: unknown argument (expected path)",
        ]);
    });

    it("tells integers from numbers", () => {
        expect(errorsOf(tool("project_create"), { name: "A", width: 1.5 })).toEqual([
            "width: expected an integer, got a number",
        ]);
        expect(errorsOf(tool("project_create"), { name: "A", width: 1280 })).toEqual([]);
    });

    it("checks array items and nested objects with their path", () => {
        expect(errorsOf(tool("assets_import"), { paths: ["/a.png", 3] })).toEqual([
            "paths[1]: expected a string, got an integer",
        ]);
        expect(errorsOf(tool("character_upsert"), { poses: [{ name: "smile" }] })).toEqual([
            "poses[0].asset: required",
        ]);
    });

    it("checks additionalProperties given as a schema", () => {
        expect(errorsOf(tool("brand_set"), { colors: { primary: "#fff", accent: 4 } })).toEqual([
            "colors.accent: expected a string, got an integer",
        ]);
    });

    it("accepts any value where the schema has no type", () => {
        expect(errorsOf(tool("variable_upsert"), { name: "x", valueType: "number", defaultValue: 3 })).toEqual([]);
        expect(errorsOf(tool("variable_upsert"), { name: "x", valueType: "string", defaultValue: "a" })).toEqual([]);
    });

    it("treats an undefined property as absent", () => {
        expect(errorsOf(tool("project_open"), { path: undefined })).toEqual(["path: required"]);
        expect(errorsOf(tool("project_open"), { path: "/p", extra: undefined })).toEqual([]);
    });

    it("applies minimum, maximum and oneOf", () => {
        const schema: AgentJsonSchema = {
            type: "object",
            properties: {
                n: { type: "integer", minimum: 1, maximum: 3 },
                v: { oneOf: [{ type: "string" }, { type: "boolean" }] },
            },
        };
        expect(errorsOf(schema, { n: 0 })).toEqual(["n: must be at least 1"]);
        expect(errorsOf(schema, { n: 4 })).toEqual(["n: must be at most 3"]);
        expect(errorsOf(schema, { v: "a" })).toEqual([]);
        expect(errorsOf(schema, { v: 2 })).toEqual(["v: must match exactly one of 2 allowed shapes (matched 0)"]);
    });

    it("caps the number of errors it reports", () => {
        const schema: AgentJsonSchema = { type: "object", properties: {}, additionalProperties: false };
        const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
        expect(errorsOf(schema, many)).toHaveLength(8);
    });

    it("is satisfied by every tool's required arguments filled with a value of the declared type", () => {
        const sample = (schema: AgentJsonSchema): unknown => {
            if (schema.enum) return schema.enum[0];
            switch (schema.type) {
                case "string": return "x";
                case "integer": return 1;
                case "number": return 1.5;
                case "boolean": return true;
                case "array": return [];
                case "object": return {};
                default: return "x";
            }
        };
        for (const descriptor of AGENT_TOOLS) {
            const args = Object.fromEntries(
                (descriptor.inputSchema.required ?? []).map(name => [name, sample(descriptor.inputSchema.properties![name])]),
            );
            expect(validateAgentArgs(descriptor.inputSchema, args), descriptor.name).toEqual({ ok: true });
        }
    });
});
