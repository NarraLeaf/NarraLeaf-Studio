import { RendererInterfaceKey } from "@shared/types/constants";

export function getInterface() {
    if (!window[RendererInterfaceKey]) {
        throw new Error("Invalid environment: Renderer interface not found");
    }
    return window[RendererInterfaceKey];
}
