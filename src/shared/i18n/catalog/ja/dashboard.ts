import type { LocaleNamespace } from "../types";

export const dashboard = {
    loading: "プロジェクトを読んでいる…",
    failed: "プロジェクトの統計を読めなかった",
    retry: "再試行",

    header: {
        lastActive: "最終作業",
        trackedSince: "集計開始",
        never: "まだなし",
    },

    greeting: {
        lateNight: "夜遅くの作業",
        morning: "おはよう",
        noon: "こんにちは",
        afternoon: "こんにちは",
        evening: "こんばんは",
    },

    units: {
        words: {
            other: "{count} 語",
        },
        days: {
            other: "{count} 日",
        },
    },

    duration: {
        hoursMinutes: "{hours} 時間 {minutes} 分",
        minutes: "{minutes} 分",
        minutesSeconds: "{minutes} 分 {seconds} 秒",
        seconds: "{seconds} 秒",
    },

    relative: {
        justNow: "たった今",
        minutesAgo: "{count} 分前",
        hoursAgo: "{count} 時間前",
        daysAgo: "{count} 日前",
    },

    scale: {
        title: "規模",
        scenes: "シーン",
        dialogueLines: "台詞の行",
        totalWords: "語数",
        characters: "キャラクター",
        assets: "アセット",
        blueprintNodes: "ブループリントのノード",
        uiSurfaces: "インターフェースのサーフェス",
        variables: "変数",
    },

    cast: {
        title: "話者別の台詞",
        speaker: "話者",
        lines: "行数",
        words: "語数",
        others: {
            other: "ほか {count} 人の話者",
        },
        showAll: "すべて表示",
        showFewer: "表示を減らす",
    },

    activity: {
        title: "執筆の記録",
        description: "直近 30 日に 1 日あたり増えた語数",
        wordsWritten: "書いた語数",
        activeTime: "作業時間",
        edits: "編集回数",
        streak: "連続日数",
        streakNone: "連続なし",
        peak: "最多 {words}",
        empty: "執筆の記録がない。1 日分の執筆が記録されると棒が現れる",
        chartLabel: "直近 30 日の 1 日あたりの執筆語数",
        tooltip: {
            added: "{date} · {words} 増えた",
            removed: "{date} · {words} 減った",
            unchanged: "{date} · 変化なし",
            start: "{date} · 集計を始めた日で、比べる基準がない",
            rebased: "{date} · 語数の数え方が変わったので、前の日とは比べられない",
            untracked: "{date} · 集計を始める前",
        },
    },

    builds: {
        title: "ビルドの履歴",
        ok: "成功",
        failed: "失敗",
        empty: "ビルドの記録がない",
        emptyHint: "このプロジェクトで走らせたビルドがここに並ぶ",
        logEmpty: "このビルドは出力を残さなかった",
        logOmitted: "記録を小さく保つため、最初の {count} 行を省いた",
    },

    structure: {
        title: "構成",
        chapters: "アウトライン",
        branches: "分岐",
    },

    localization: {
        title: "ローカライズ",
        translated: "翻訳済み",
        reviewed: "確認済み",
        untranslated: "未翻訳",
        summary: "{total} 件中 {completed} 件が翻訳済み",
    },

    footer: {
        openOnWorkspaceOpen: "ワークスペースを開くたびにこのダッシュボードを表示する",
        clear: "このプロジェクトの統計を消去",
        clearConfirm: "このプロジェクトの統計を消去するか",
        clearDetail:
            "執筆の推移、作業時間、編集回数、ビルドの履歴を消す。プロジェクト自体から数えている値は変わらない。元には戻せない",
    },
} satisfies LocaleNamespace<"dashboard">;
