/**
 * Type-safe payload helpers for panels and editor tabs
 * 
 * This file provides utilities to work with strongly-typed payloads
 * for panels and editor tabs, ensuring type safety throughout the application.
 */

import { ComponentType } from "react";
import { PanelDefinition, EditorTabDefinition } from "./types";
import { PanelComponentProps, EditorTabComponentProps } from "@/lib/workspace/services/ui/types";

/**
 * Create a type-safe panel definition with payload
 * 
 * Usage:
 * ```typescript
 * interface MyPanelPayload {
 *   userId: string;
 *   viewMode: 'grid' | 'list';
 * }
 * 
 * const myPanel = createPanel<MyPanelPayload>({
 *   id: 'my-panel',
 *   title: 'My Panel',
 *   icon: <Icon />,
 *   position: PanelPosition.Left,
 *   component: MyPanelComponent,
 *   payload: {
 *     userId: '123',
 *     viewMode: 'grid'
 *   }
 * });
 * ```
 */
export function createPanel<TPayload = any>(
    definition: Omit<PanelDefinition<TPayload>, 'component'> & {
        component: ComponentType<PanelComponentProps<TPayload>>;
    }
): PanelDefinition<TPayload> {
    return definition as PanelDefinition<TPayload>;
}

/**
 * Create a type-safe editor tab definition with payload
 * 
 * Usage:
 * ```typescript
 * interface FileEditorPayload {
 *   filePath: string;
 *   lineNumber?: number;
 *   readOnly?: boolean;
 * }
 * 
 * const fileTab = createEditorTab<FileEditorPayload>({
 *   id: 'file-editor-123',
 *   title: 'config.json',
 *   icon: <FileIcon />,
 *   component: FileEditorComponent,
 *   payload: {
 *     filePath: '/path/to/config.json',
 *     lineNumber: 42,
 *     readOnly: false
 *   }
 * });
 * ```
 */
export function createEditorTab<TPayload = any>(
    definition: Omit<EditorTabDefinition<TPayload>, 'component'> & {
        component: ComponentType<EditorTabComponentProps<TPayload>>;
    }
): EditorTabDefinition<TPayload> {
    return definition as EditorTabDefinition<TPayload>;
}

/**
 * Type guard to check if a panel has a payload
 */
export function hasPayload<TPayload>(
    definition: PanelDefinition<TPayload> | EditorTabDefinition<TPayload>
): definition is (PanelDefinition<TPayload> | EditorTabDefinition<TPayload>) & { payload: TPayload } {
    return definition.payload !== undefined && definition.payload !== null;
}

/**
 * Extract payload type from a panel or editor tab definition
 * 
 * Usage:
 * ```typescript
 * type MyPayload = PayloadOf<typeof myPanel>;
 * ```
 */
export type PayloadOf<T> = T extends PanelDefinition<infer P>
    ? P
    : T extends EditorTabDefinition<infer P>
    ? P
    : never;

/**
 * Helper to update payload in a type-safe manner
 * Returns a new definition with the updated payload
 */
export function withPayload<TPayload>(
    definition: PanelDefinition<TPayload> | EditorTabDefinition<TPayload>,
    payload: TPayload
): typeof definition {
    return {
        ...definition,
        payload,
    };
}

/**
 * Helper to merge payload in a type-safe manner
 * Performs a shallow merge of the new payload with the existing one
 */
export function mergePayload<TPayload extends Record<string, any>>(
    definition: PanelDefinition<TPayload> | EditorTabDefinition<TPayload>,
    partialPayload: Partial<TPayload>
): typeof definition {
    return {
        ...definition,
        payload: {
            ...(definition.payload || {} as TPayload),
            ...partialPayload,
        },
    };
}

/**
 * Create a typed panel component
 * Ensures the component receives the correct payload type
 * 
 * Usage:
 * ```typescript
 * interface MyPayload {
 *   data: string[];
 * }
 * 
 * const MyPanel = createPanelComponent<MyPayload>(({ panelId, payload }) => {
 *   // payload is strongly typed as MyPayload | undefined
 *   const data = payload?.data || [];
 *   return <div>{data.join(', ')}</div>;
 * });
 * ```
 */
export function createPanelComponent<TPayload>(
    component: ComponentType<PanelComponentProps<TPayload>>
): ComponentType<PanelComponentProps<TPayload>> {
    return component;
}

/**
 * Create a typed editor tab component
 * Ensures the component receives the correct payload type
 * 
 * Usage:
 * ```typescript
 * interface EditorPayload {
 *   content: string;
 *   language: string;
 * }
 * 
 * const MyEditor = createEditorComponent<EditorPayload>(({ tabId, payload }) => {
 *   // payload is strongly typed as EditorPayload | undefined
 *   const content = payload?.content || '';
 *   const language = payload?.language || 'plaintext';
 *   return <CodeEditor content={content} language={language} />;
 * });
 * ```
 */
export function createEditorComponent<TPayload>(
    component: ComponentType<EditorTabComponentProps<TPayload>>
): ComponentType<EditorTabComponentProps<TPayload>> {
    return component;
}

