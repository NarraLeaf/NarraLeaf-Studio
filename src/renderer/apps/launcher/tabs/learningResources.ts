/**
 * Learning tab content — a plain data file so entries can be added without touching the UI.
 *
 * Titles/descriptions are authored strings (edit freely, Chinese-first like the target audience);
 * the section headers come from i18n. Every URL must be http(s) — the card opens it in the
 * system browser via `app.openExternal`, which refuses anything else.
 *
 * 内容后补：往对应分类的数组里加条目即可。仅收录确认存在的链接；
 * 教程/示例的具体页面上线后按下面的形状补充。
 */

export type LearningResourceCategory = "tutorials" | "examples" | "docs";

export interface LearningResource {
    /** Stable key for React lists; never shown to users. */
    id: string;
    category: LearningResourceCategory;
    title: string;
    description: string;
    url: string;
}

export const LEARNING_RESOURCES: readonly LearningResource[] = [
    // --- 教程 -----------------------------------------------------------------
    {
        id: "tutorial-studio-getting-started",
        category: "tutorials",
        title: "Studio 入门",
        description: "从创建项目到预览第一段剧情，认识工作区的各个部分。",
        url: "https://www.narraleaf.com/docs/studio",
    },

    // --- 示例 -----------------------------------------------------------------
    // 示例项目上线后按此形状补充：
    // {
    //     id: "example-visual-novel-demo",
    //     category: "examples",
    //     title: "示例项目：……",
    //     description: "……",
    //     url: "https://…",
    // },

    // --- 文档 -----------------------------------------------------------------
    {
        id: "docs-studio",
        category: "docs",
        title: "Studio 文档",
        description: "NarraLeaf Studio 的官方使用文档。",
        url: "https://www.narraleaf.com/docs/studio",
    },
    {
        id: "docs-website",
        category: "docs",
        title: "NarraLeaf 官网",
        description: "引擎介绍、新闻与生态入口。",
        url: "https://www.narraleaf.com",
    },
    {
        id: "docs-github",
        category: "docs",
        title: "GitHub 组织",
        description: "NarraLeaf 的开源仓库：引擎、运行时与周边工具。",
        url: "https://github.com/NarraLeaf",
    },
    {
        id: "docs-narraleaf-react",
        category: "docs",
        title: "NarraLeaf-React 仓库",
        description: "驱动游戏运行时的开源渲染引擎。",
        url: "https://github.com/NarraLeaf/narraleaf-react",
    },
];
