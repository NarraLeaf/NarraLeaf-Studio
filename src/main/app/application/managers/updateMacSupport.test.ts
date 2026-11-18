import { describe, expect, it } from "vitest";
import { appBundlePath, isTranslocated, requirementNamesCertificate } from "./updateMacSupport";

describe("appBundlePath", () => {
    it("climbs from the executable to the .app", () => {
        expect(appBundlePath("/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio")).toBe("/Applications/NarraLeaf Studio.app");
    });

    it("is null outside a bundle", () => {
        expect(appBundlePath("/usr/local/bin/electron")).toBeNull();
    });
});

describe("isTranslocated", () => {
    it("recognises Gatekeeper's read-only copy", () => {
        expect(isTranslocated("/private/var/folders/xy/T/AppTranslocation/1A2B/d/NarraLeaf Studio.app")).toBe(true);
        expect(isTranslocated("/Applications/NarraLeaf Studio.app")).toBe(false);
    });
});

describe("requirementNamesCertificate", () => {
    it("accepts a certificate-signed bundle", () => {
        expect(requirementNamesCertificate('Executable=/x\ndesignated => identifier "com.narraleaf.studio" and certificate root = H"0123abcd"\n')).toBe(true);
        expect(requirementNamesCertificate('designated => anchor apple generic and identifier "com.narraleaf.studio"')).toBe(true);
    });

    it("rejects an ad-hoc signature and an unsigned bundle", () => {
        expect(requirementNamesCertificate('Executable=/x\ndesignated => cdhash H"0123abcd"\n')).toBe(false);
        expect(requirementNamesCertificate("")).toBe(false);
    });
});
