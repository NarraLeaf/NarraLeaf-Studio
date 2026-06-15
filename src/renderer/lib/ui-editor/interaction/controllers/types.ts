import type { MoveableProps } from "react-moveable";
import type { ReactNode } from "react";

export interface InteractionController {
    id: string;
    priority: number;
    match: boolean;
    targets: HTMLElement[];
    moveableProps: Partial<MoveableProps>;
    overlay?: ReactNode;
}
