import type { CSSProperties } from "react";
import type { StoryTextMarks, StoryTextSegment } from "@shared/types/story";

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

/**
 * Read-only WYSIWYG rendering of a text segment: rich marks (bold / italic / color / fontSize) are
 * applied inline; pause runs are omitted (they are not shown in the row preview).
 */
export function RichTextView(props: { segment: StoryTextSegment; className?: string }) {
    const { segment } = props;
    if (!segment.rich || segment.rich.length === 0) {
        return <span className={props.className}>{segment.value}</span>;
    }
    return (
        <span className={props.className}>
            {segment.rich.map((run, index) => {
                if (!("text" in run)) {
                    return null;
                }
                const style = markStyle(run.marks);
                return style ? <span key={index} style={style}>{run.text}</span> : <span key={index}>{run.text}</span>;
            })}
        </span>
    );
}
