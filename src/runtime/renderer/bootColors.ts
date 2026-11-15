import { bootScreenAccent } from "@/lib/ui-editor/runtime/app/bootScreenAccent";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveRuntimeBootColors, type RuntimeBootColors } from "./bootAppearance";

/** Resolve the shell's background and the indicator drawn over it. */
export function resolveRuntimeBootDisplayColors(pack: GameRuntimePackV1 | null): RuntimeBootColors {
    const colors = resolveRuntimeBootColors(pack);
    return pack ? { background: colors.background, accent: bootScreenAccent(colors.background) } : colors;
}
