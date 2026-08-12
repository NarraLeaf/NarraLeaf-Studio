import type { LocaleNamespace } from "../types";

export const launcher = {
    nav: {
        projects: "プロジェクト",
        plugins: "プラグイン",
        learning: "学習",
        settings: "設定",
    },
    projects: {
        title: "プロジェクト",
        // 「新規」ではなく「追加」。このボタンの先のウィザードはパッケージの展開やサーバーからの
        // クローンもできて、そのどちらも新しく作る操作ではない。
        addProject: "プロジェクトを追加",
        openProject: "プロジェクトを開く",
        recentTitle: "最近のプロジェクト",
        openFolder: "フォルダを開く",
        openNamed: "{name} を開く",
        search: {
            placeholder: "プロジェクトを検索",
            clear: "検索を消去",
            empty: "\"{query}\" に一致するプロジェクトがない",
        },
        // 最初のプロジェクトを開くまでのタブ全体。下に並ぶ 2 枚のタイルが「置き方」で、
        // この 1 行が「ここに何が並ぶか」。
        empty: {
            title: "NarraLeaf Studio へようこそ",
            subtitle: "開いたプロジェクトがここに並ぶ",
            openFolder: "開く…",
        },
        // 応答する OS の呼び名で書く。作者がこの先で見るのはその画面そのものなので、
        // 独自の言い方をすると別のものが開くように読める。
        revealInFinder: "Finder で表示",
        revealInExplorer: "エクスプローラーで表示",
        revealInFileManager: "ファイルマネージャーで表示",
        errorReveal: "プロジェクトフォルダを開けなかった",
        removeFromRecent: "最近の一覧から取り除く",
        removeConfirm: {
            title: "最近の一覧から取り除く",
            message: "{name} はこの一覧に出なくなる。ディスク上のものは消えない",
            confirm: "取り除く",
        },
        moreActions: "その他の操作",
        moreActionsNamed: "{name} のその他の操作",
        removeNamedFromRecent: "{name} を最近のプロジェクトから取り除く",
        errorCreate: "プロジェクトを追加できなかった",
        errorOpenFolder: "フォルダを開けなかった",
        // 起動時に最近の一覧をひと通り調べた結果。useMissingRecentProjects を参照。
        missing: {
            reasonFolderMissing: "このプロジェクトフォルダは削除されたか移動された",
            reasonNotAProject: "このフォルダはもう NarraLeaf プロジェクトではない",
            dialogTitle: "プロジェクトが見つからない",
            note: "取り除いてもこの一覧が変わるだけ。ディスク上のものは消えない",
            relocate: "場所を指定…",
            remove: "一覧から取り除く",
            errorNotAProject: "そのフォルダは NarraLeaf プロジェクトではない",
        },
    },
    // 日本語に単複の区別はないので `.other` だけを訳し、`.one` は英語へフォールバックさせる。
    recentCount: {
        other: "最近のプロジェクト {count} 件",
    },
} satisfies LocaleNamespace<"launcher">;
