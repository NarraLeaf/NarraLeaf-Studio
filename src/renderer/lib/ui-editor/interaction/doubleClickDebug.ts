const DEBUG_STORAGE_KEY = "nl.uiEditor.debugDoubleClick";

export function isUIDoubleClickDebugEnabled(): boolean {
    const globalFlag = (globalThis as { __NL_UI_EDITOR_DEBUG_DOUBLE_CLICK__?: unknown })
        .__NL_UI_EDITOR_DEBUG_DOUBLE_CLICK__;
    if (globalFlag === true) {
        return true;
    }
    try {
        return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function describeDoubleClickTarget(target: EventTarget | Element | null | undefined): string | null {
    if (!(target instanceof Element)) {
        return null;
    }
    const classes = typeof target.className === "string" && target.className.trim()
        ? `.${target.className.trim().split(/\s+/).slice(0, 4).join(".")}`
        : "";
    const uiElement = target.closest("[data-ui-element-id]") as HTMLElement | null;
    const uiId = uiElement?.dataset.uiElementId ? ` ui=${uiElement.dataset.uiElementId}` : "";
    return `<${target.tagName.toLowerCase()}${classes}${uiId}>`;
}

export function debugUIDoubleClick(stage: string, payload: Record<string, unknown>): void {
    if (!isUIDoubleClickDebugEnabled()) {
        return;
    }
    console.info("[UIEditor doubleclick]", stage, payload);
}
