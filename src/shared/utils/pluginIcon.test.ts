import { describe, expect, it } from "vitest";
import { PLUGIN_ICON_MAX_BYTES } from "../constants/pluginIcon";
import { pluginIconExtension, validatePluginIconBytes } from "./pluginIcon";

/** PNG signature + an IHDR chunk carrying the given dimensions. */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const bytes = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ];
  while (bytes.length < padTo) {
    bytes.push(0);
  }
  return Uint8Array.from(bytes);
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

describe("pluginIconExtension", () => {
  it("accepts the allowed raster extensions, case-insensitively", () => {
    expect(pluginIconExtension("icon.png")).toBe("png");
    expect(pluginIconExtension("assets/Icon.PNG")).toBe("png");
    expect(pluginIconExtension("icon.webp")).toBe("webp");
    expect(pluginIconExtension("icon.jpg")).toBe("jpg");
    expect(pluginIconExtension("icon.jpeg")).toBe("jpeg");
  });

  it("rejects documents and animations dressed as icons", () => {
    expect(pluginIconExtension("icon.svg")).toBeNull();
    expect(pluginIconExtension("icon.gif")).toBeNull();
    expect(pluginIconExtension("icon")).toBeNull();
  });
});

describe("validatePluginIconBytes", () => {
  it("accepts a square icon within the size range", () => {
    expect(validatePluginIconBytes(png(512, 512), "icon.png")).toBeNull();
    expect(validatePluginIconBytes(png(64, 64), "icon.png")).toBeNull();
  });

  it("rejects a non-square icon", () => {
    expect(validatePluginIconBytes(png(512, 256), "icon.png")).toMatch(/square \(got 512x256\)/);
  });

  it("rejects an icon past the maximum dimension", () => {
    expect(validatePluginIconBytes(png(513, 513), "icon.png")).toMatch(/at most 512x512/);
  });

  it("rejects an icon below the minimum dimension", () => {
    expect(validatePluginIconBytes(png(32, 32), "icon.png")).toMatch(/at least 64x64/);
  });

  it("rejects an icon past the byte budget", () => {
    expect(validatePluginIconBytes(png(512, 512, PLUGIN_ICON_MAX_BYTES + 1), "icon.png")).toMatch(
      /at most 512 KB/
    );
  });

  it("rejects bytes whose format contradicts the extension", () => {
    expect(validatePluginIconBytes(png(512, 512), "icon.webp")).toMatch(
      /is a PNG file with a \.webp name/
    );
  });

  it("rejects bytes that are not a readable image", () => {
    const svg = Uint8Array.from(
      [...'<svg xmlns="http://www.w3.org/2000/svg"></svg>'].map((c) => c.charCodeAt(0))
    );
    expect(validatePluginIconBytes(svg, "icon.png")).toMatch(/not a readable PNG image/);
  });

  it("rejects an extension outside the allowlist", () => {
    expect(validatePluginIconBytes(png(512, 512), "icon.svg")).toMatch(/must be one of/);
  });
});
