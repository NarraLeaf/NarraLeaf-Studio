import type { CSSProperties } from "react";
import { Braces, Pause } from "lucide-react";
import type { StoryDocument, StorySceneId, StoryTextMarks, StoryTextSegment } from "@shared/types/story";
import { resolveInterpolationName } from "./storyInterpolation";

function markStyle(marks: StoryTextMarks | undefined): CSSProperties | undefined {
    if (!marks) {
        return undefined;
    }
    const style: CSSProperties = {};
    if (marks.bold) style.fontWeight = 700;
    if (marks.italic) style.fontStyle = "italic";
    if (marks.color) style.color = marks.color;
    if (typeof marks.fontSize === "number") style.fontSize = marks.fontSize;
    return Object.keys(style).length > 0 ? style : undefined;
}

const PAUSE_CHIP = "mx-0.5 inline-flex select-none items-center gap-0.5 rounded bg-primary/20 px-1 py-0.5 align-middle text-2xs font-medium text-primary";
const INTERP_CHIP = "mx-0.5 inline-flex select-none items-center gap-0.5 rounded bg-emerald-500/20 px-1 py-0.5 align-middle text-2xs font-medium text-emerald-300";

/**
 * Read-only WYSIWYG rendering of a text segment: rich marks (bold / italic / color / fontSize) are
 * applied inline; pause and interpolation runs render as compact read-only chips (shown in the row
 * preview). Pass `document` + `sceneId` to resolve interpolation variable names.
 */
export function RichTextView(props: {
    segment: StoryTextSegment;
    className?: string;
    document?: StoryDocument;
    sceneId?: StorySceneId;
}) {
    const { segment } = props;
    if (!segment.rich || segment.rich.length === 0) {
        return <span className={props.className}>{segment.value}</span>;
    }
    return (
        <span className={props.className}>
            {segment.rich.map((run, index) => {
                if ("text" in run) {
                    const style = markStyle(run.marks);
                    return style ? <span key={index} style={style}>{run.text}</span> : <span key={index}>{run.text}</span>;
                }
                if ("pause" in run) {
                    return (
                        <span key={index} className={PAUSE_CHIP} title={run.pause === true ? "Pause — waits for a click" : `Pause — ${run.pause}ms`}>
                            <Pause className="h-2.5 w-2.5" />
                            {run.pause === true ? null : <span>{run.pause}ms</span>}
                        </span>
                    );
                }
                const label = props.document && props.sceneId
                    ? resolveInterpolationName(props.document, props.sceneId, [], run.interpolation)
                    : "value";
                // Marks style the value text only — never the chip background.
                const labelStyle = markStyle(run.marks);
                return (
                    <span key={index} className={INTERP_CHIP} title={`Inserted value: ${label}`}>
                        <Braces className="h-2.5 w-2.5" />
                        <span style={labelStyle}>{label}</span>
                    </span>
                );
            })}
        </span>
    );
}
