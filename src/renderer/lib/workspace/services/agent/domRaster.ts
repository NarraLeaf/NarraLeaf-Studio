/**
 * A rendered page, as a PNG: the DOM drawn through an SVG `foreignObject` onto a canvas.
 *
 * Nothing in the repository rasterises arbitrary DOM - the engine's `capturePng` photographs its own
 * stage, and the project-icon baker draws images it already holds - so this is the technique done by
 * hand. An SVG image is an isolated document: it loads nothing and inherits no stylesheet, so
 * everything the page needs is carried into it.
 *
 * - **Styles** are copied from each element's computed style onto its clone, property by property.
 *   That is what makes the copy independent of Studio's stylesheets (and of the engine's Tailwind v4
 *   sheet that shadows them), at the price of a large string. Pseudo-elements are carried as rules.
 *   Animations and transitions are switched off on the copy: the computed values already hold the
 *   state being shown, and an animation restarting inside the image would photograph its first frame.
 * - **Images** - `<img>`, CSS `url()`s, a canvas's pixels, a video's current frame - are inlined as
 *   data URLs. `blob:` and `app:` addresses are read through `fetch`, which never leaves the machine;
 *   anything else is dropped, because the renderer does not touch the network.
 * - **Fonts** a page names are embedded as `@font-face` rules with their bytes, through the
 *   resolver the caller passes (project fonts) and the document's own same-origin `@font-face` rules.
 *   A font that is only a `FontFace` object with no reachable source falls back to the system font.
 *
 * Comments in English per project convention.
 */

import type { ScreenshotPlan } from "./screenshotGeometry";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Properties whose value can hold a `url()` that must travel with the copy. */
const URL_PROPERTIES = ["background-image", "mask-image", "-webkit-mask-image", "border-image-source", "list-style-image", "content", "cursor"];

export type RasterizeOptions = {
    /** The page root: the element whose box is the whole page. */
    node: HTMLElement;
    /** The page's design size, which is the size of the SVG document it is drawn into. */
    design: { width: number; height: number };
    plan: ScreenshotPlan;
    /** `@font-face` CSS (with inlined bytes) for a family the page names, or null when unknown. */
    resolveFontFace?: (family: string) => Promise<string | null>;
    /** How long to wait for images and fonts before photographing what there is. */
    resourceTimeoutMs?: number;
};

export type RasterizeResult = {
    /** Base64 PNG, without the `data:` prefix. */
    png: string;
    /** Resources that could not be carried into the picture, for the caller to mention. */
    missing: string[];
};

/** Wait for every image under `node` to finish (or fail), and for the document's fonts, within `timeoutMs`. */
export async function waitForPageResources(node: HTMLElement, timeoutMs: number): Promise<void> {
    const images = Array.from(node.querySelectorAll("img")).filter(image => !image.complete);
    const loads = images.map(image => new Promise<void>(resolve => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
    }));
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve();
    await Promise.race([Promise.all([...loads, fonts]), delay(timeoutMs)]);
}

/**
 * Let the page settle after mounting: two macrotasks for effects and the first layout, then a short
 * pause for anything an effect started. Timers, not animation frames - a window macOS considers
 * occluded runs no frames at all, and a screenshot must not hang on one.
 */
export async function settle(ms = 60): Promise<void> {
    await delay(0);
    await delay(0);
    await delay(ms);
}

export async function rasterizeElement(options: RasterizeOptions): Promise<RasterizeResult> {
    const { node, design, plan } = options;
    await waitForPageResources(node, options.resourceTimeoutMs ?? 5000);

    const inliner = new ResourceInliner();
    const pseudoRules: string[] = [];
    const families = new Set<string>();
    const clone = cloneWithStyles(node, { inliner, pseudoRules, families, nextPseudo: { value: 0 } });
    if (!(clone instanceof HTMLElement)) {
        throw new Error("The page could not be copied.");
    }
    // The page root sits at the top-left of the picture whatever offset it had in its host box.
    clone.style.setProperty("position", "relative");
    clone.style.setProperty("left", "0px");
    clone.style.setProperty("top", "0px");
    clone.style.setProperty("margin", "0px");
    clone.style.setProperty("transform", "none");

    await inliner.settle();
    const fontCss = await embedFonts(families, options.resolveFontFace, inliner);

    const wrapper = document.createElementNS(XHTML_NS, "div") as HTMLDivElement;
    wrapper.setAttribute("style", `width:${design.width}px;height:${design.height}px;overflow:hidden;position:relative;margin:0;padding:0`);
    const style = document.createElementNS(XHTML_NS, "style");
    style.textContent = [...fontCss, ...pseudoRules].join("\n");
    wrapper.appendChild(style);
    wrapper.appendChild(clone);
    const markup = new XMLSerializer().serializeToString(wrapper);

    const scale = plan.scale;
    const svg =
        `<svg xmlns="${SVG_NS}" width="${Math.ceil(design.width * scale)}" height="${Math.ceil(design.height * scale)}" ` +
        `viewBox="0 0 ${design.width} ${design.height}">` +
        `<foreignObject x="0" y="0" width="${design.width}" height="${design.height}">${markup}</foreignObject></svg>`;

    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("No 2D canvas is available.");
    }
    context.drawImage(
        image,
        plan.source.x * scale,
        plan.source.y * scale,
        plan.source.width * scale,
        plan.source.height * scale,
        0,
        0,
        plan.width,
        plan.height,
    );
    return { png: stripDataUrl(canvas.toDataURL("image/png")), missing: inliner.missing };
}

/** Downscale a PNG/JPEG data URL so its longer edge is at most `maxSize`, as base64 PNG. */
export async function downscaleImage(dataUrl: string, maxSize: number): Promise<{ png: string; width: number; height: number }> {
    const image = await loadImage(dataUrl);
    const natural = { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    const scale = Math.min(1, Math.max(16, maxSize) / Math.max(1, natural.width, natural.height));
    const width = Math.max(1, Math.round(natural.width * scale));
    const height = Math.max(1, Math.round(natural.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("No 2D canvas is available.");
    }
    context.drawImage(image, 0, 0, width, height);
    return { png: stripDataUrl(canvas.toDataURL("image/png")), width, height };
}

export function stripDataUrl(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

// ── Cloning ──────────────────────────────────────────────────────────────────────────────────────

type CloneContext = {
    inliner: ResourceInliner;
    pseudoRules: string[];
    families: Set<string>;
    nextPseudo: { value: number };
};

const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"]);

function cloneWithStyles(source: Node, context: CloneContext): Node | null {
    if (source.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(source.textContent ?? "");
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }
    const element = source as Element;
    if (SKIPPED_TAGS.has(element.tagName)) {
        return null;
    }
    const replacement = replacementFor(element, context);
    const clone = replacement ?? (element.cloneNode(false) as Element);
    copyComputedStyle(element, clone, context);
    copyPseudoElements(element, clone, context);
    // A replaced element's pixels are already in its replacement; its children (a video's sources, a
    // canvas's fallback) are not what is on screen.
    if (!replacement) {
        for (const child of Array.from(element.childNodes)) {
            const copied = cloneWithStyles(child, context);
            if (copied) {
                clone.appendChild(copied);
            }
        }
    }
    if (element instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
        clone.removeAttribute("srcset");
        clone.removeAttribute("loading");
        const src = element.currentSrc || element.src;
        if (src) {
            context.inliner.inline(src, dataUrl => {
                if (dataUrl) {
                    clone.setAttribute("src", dataUrl);
                } else {
                    clone.removeAttribute("src");
                }
            });
        }
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        clone.setAttribute("value", element.value);
        if (element instanceof HTMLTextAreaElement) {
            clone.textContent = element.value;
        }
    }
    return clone;
}

/** Elements whose pixels are not in their markup: a canvas, a video frame, a frame document. */
function replacementFor(element: Element, context: CloneContext): Element | null {
    if (element instanceof HTMLCanvasElement) {
        const image = document.createElement("img");
        try {
            image.setAttribute("src", element.toDataURL("image/png"));
        } catch {
            context.inliner.missing.push("a canvas whose pixels could not be read");
        }
        return image;
    }
    if (element instanceof HTMLVideoElement) {
        const image = document.createElement("img");
        try {
            const canvas = document.createElement("canvas");
            canvas.width = element.videoWidth || element.clientWidth || 1;
            canvas.height = element.videoHeight || element.clientHeight || 1;
            canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
            image.setAttribute("src", canvas.toDataURL("image/png"));
        } catch {
            context.inliner.missing.push("a video frame");
        }
        return image;
    }
    if (element instanceof HTMLIFrameElement) {
        return document.createElement("div");
    }
    return null;
}

function copyComputedStyle(source: Element, clone: Element, context: CloneContext): void {
    const computed = getComputedStyle(source);
    const target = (clone as HTMLElement | SVGElement).style;
    if (!target) {
        return;
    }
    for (let index = 0; index < computed.length; index += 1) {
        const property = computed[index];
        target.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
    }
    target.setProperty("animation", "none");
    target.setProperty("transition", "none");
    for (const property of URL_PROPERTIES) {
        const value = computed.getPropertyValue(property);
        if (value && value.includes("url(")) {
            context.inliner.inlineCssValue(value, inlined => target.setProperty(property, inlined));
        }
    }
    collectFamilies(computed.getPropertyValue("font-family"), context.families);
}

function copyPseudoElements(source: Element, clone: Element, context: CloneContext): void {
    for (const pseudo of ["::before", "::after"] as const) {
        const computed = getComputedStyle(source, pseudo);
        const content = computed.getPropertyValue("content");
        if (!content || content === "none" || content === "normal") {
            continue;
        }
        const className = `nlx-p${context.nextPseudo.value++}`;
        clone.classList.add(className);
        const declarations: string[] = [];
        for (let index = 0; index < computed.length; index += 1) {
            const property = computed[index];
            declarations.push(`${property}:${computed.getPropertyValue(property)}`);
        }
        const ruleIndex = context.pseudoRules.length;
        context.pseudoRules.push(`.${className}${pseudo}{${declarations.join(";")}}`);
        const rule = context.pseudoRules[ruleIndex];
        if (rule.includes("url(")) {
            context.inliner.inlineCssValue(rule, inlined => {
                context.pseudoRules[ruleIndex] = inlined;
            });
        }
        collectFamilies(computed.getPropertyValue("font-family"), context.families);
    }
}

function collectFamilies(value: string, families: Set<string>): void {
    for (const part of value.split(",")) {
        const family = part.trim().replace(/^["']|["']$/g, "");
        if (family) {
            families.add(family);
        }
    }
}

// ── Fonts ────────────────────────────────────────────────────────────────────────────────────────

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "emoji", "math", "inherit", "initial"]);

async function embedFonts(
    families: ReadonlySet<string>,
    resolveFontFace: RasterizeOptions["resolveFontFace"],
    inliner: ResourceInliner,
): Promise<string[]> {
    const wanted = [...families].filter(family => !GENERIC_FAMILIES.has(family.toLowerCase()));
    const rules: string[] = [];
    const covered = new Set<string>();
    for (const family of wanted) {
        const css = resolveFontFace ? await resolveFontFace(family).catch(() => null) : null;
        if (css) {
            rules.push(css);
            covered.add(family);
        }
    }
    // The document's own `@font-face` rules, for families the resolver did not know.
    const remaining = new Set(wanted.filter(family => !covered.has(family)).map(family => family.toLowerCase()));
    if (remaining.size > 0) {
        for (const sheet of Array.from(document.styleSheets)) {
            let cssRules: CSSRuleList;
            try {
                cssRules = sheet.cssRules;
            } catch {
                continue;
            }
            for (const rule of Array.from(cssRules)) {
                if (!(rule instanceof CSSFontFaceRule)) {
                    continue;
                }
                const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "").toLowerCase();
                if (!remaining.has(family)) {
                    continue;
                }
                const index = rules.length;
                rules.push(rule.cssText);
                inliner.inlineCssValue(rule.cssText, inlined => {
                    rules[index] = inlined;
                });
            }
        }
        await inliner.settle();
    }
    return rules;
}

// ── Resources ────────────────────────────────────────────────────────────────────────────────────

/** Reads each distinct address once and hands every requester the data URL (or null). */
class ResourceInliner {
    public readonly missing: string[] = [];
    private readonly cache = new Map<string, Promise<string | null>>();
    private readonly pending: Promise<void>[] = [];

    public inline(url: string, apply: (dataUrl: string | null) => void): void {
        this.pending.push(this.read(url).then(apply));
    }

    /** Replace every `url(...)` in a CSS value or rule with its data URL; unreadable ones become `none`-safe empties. */
    public inlineCssValue(value: string, apply: (inlined: string) => void): void {
        const urls = [...value.matchAll(/url\((['"]?)(.*?)\1\)/g)].map(match => match[2]);
        if (urls.length === 0) {
            return;
        }
        this.pending.push(
            Promise.all(urls.map(url => this.read(url).then(dataUrl => [url, dataUrl] as const))).then(pairs => {
                let next = value;
                for (const [url, dataUrl] of pairs) {
                    next = next.split(url).join(dataUrl ?? "data:,");
                }
                apply(next);
            }),
        );
    }

    public async settle(): Promise<void> {
        while (this.pending.length > 0) {
            const batch = this.pending.splice(0);
            await Promise.all(batch);
        }
    }

    private read(url: string): Promise<string | null> {
        if (url.startsWith("data:")) {
            return Promise.resolve(url);
        }
        let cached = this.cache.get(url);
        if (!cached) {
            cached = this.fetchAsDataUrl(url);
            this.cache.set(url, cached);
        }
        return cached;
    }

    private async fetchAsDataUrl(url: string): Promise<string | null> {
        // Local addresses only: the renderer never reaches the network, and a page that names a remote
        // picture is photographed without it rather than fetched.
        if (!/^(blob:|app:|file:)/i.test(url) && !url.startsWith(location.origin)) {
            this.missing.push(url);
            return null;
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                this.missing.push(url);
                return null;
            }
            return await blobToDataUrl(await response.blob());
        } catch {
            this.missing.push(url);
            return null;
        }
    }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
        reader.readAsDataURL(blob);
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "sync";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The page could not be drawn as an image."));
        image.src = src;
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}
