import type { LocaleNamespace } from "../types";

/**
 * `lint` 日本語。プロジェクトの検査。ルールの名前と本文、レポートタブ、コンソールのチャンネル、
 * そして「プロジェクト → 検査」の設定。
 *
 * この名前空間が守る決まりが 2 つあり、どちらも別のテストが見張っている。
 *
 *  - ルールごとに `title`、`description`、`message` を camelCase のスラグの下に置く
 *    （`lint.rule.<slug>`）。登録済みのルールでどれかが欠けていると `registry.test.ts` が落ちる。
 *    ルールの変種の本文は `message` の隣に `message<Variant>` として並べる。
 *  - `title` は短い名詞句、`description` は 1 節で、ヒントのポップオーバーにしか出ない。
 *
 * **本文は見つかった場所を名乗らない。** 本文を出す画面はどれも場所を隣に出す。レポートタブは
 * 専用の列で、ビルドのコンソールは `nonRedundantLintLocation` を通して。
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "使われていないアセット",
            description: "プロジェクトのどこからも参照されていないアセット",
            message: "{asset} はどこからも使われていない",
            // 参照の索引がプロジェクト全体を覆えていないとき、一覧の代わりに出す 3 つ。
            // 場所を名指すことが要点で、「索引が不完全」とだけ言っても作者には見に行く先が無い。
            messageIndexUnresolved: "使われていないアセットを一覧にできない：{location} が指すアセットを特定できない",
            messageIndexUnreadable: "使われていないアセットを一覧にできない：{location} を読めなかった",
            messageIndexNotBuilt: "使われていないアセットを一覧にできない：プロジェクトを調べられなかった",
        },
        assetsMissing: {
            title: "アセットが見つからない",
            description: "ライブラリにもう無いアセットを指す参照",
            message: "{location} が存在しないアセットを参照している",
        },
        assetsUnreadable: {
            title: "読めないアセット",
            description: "ファイルを読めないか、デコードできない",
            message: "{asset} をデコードできない",
            messageMissingBytes: "{asset} をディスクから読めない",
        },
        assetsOversized: {
            title: "大きすぎるファイル",
            description: "ビルドが運ぶファイルのうち、このプロジェクトが決めた大きさを超えるもの",
            // 数字を 2 つとも文に入れる。このファイルが何 MB で、プロジェクトが何と言ったか。
            // 出どころの設定ページを開かなくても、この所見だけで手を打てるようにする。
            message: "{asset} は {size} で、ビルドが運ぶべき {limit} を超えている",
        },
        portabilityAssetName: {
            title: "安全でないファイル名",
            description: "一部のファイルシステムが受け付けない文字や名前",
            message: "{asset} は書き出せないプラットフォームがある",
        },
        portabilityCaseCollision: {
            title: "大文字小文字の衝突",
            description: "大文字小文字だけが違う名前",
            message: "{asset} は大文字小文字を区別しないファイルシステムで {other} と衝突する",
        },
        portabilityMediaFormat: {
            title: "再生できない形式",
            description: "選んだビルド対象の一部が再生できないコーデック",
            message: "{asset} は {platform} で再生できない",
        },
        networkFetchNotAllowlisted: {
            title: "許可一覧にないアドレス",
            description: "このプロジェクトが許可していないアドレスを指す Fetch ノード",
            message: "{url} はこのプロジェクトのネットワーク要求許可一覧にない",
        },
        networkFetchDisallowed: {
            title: "ネットワークを使えないのにネットワークノードがある",
            description: "ネットワークポリシーが「使わない」のプロジェクトにあるネットワークノード",
            message: "{blueprint} はネットワーク要求を行うが、このプロジェクトはそれを許可していない",
        },
        storyInvalidCommand: {
            title: "無効なコマンド",
            description: "コンパイラが受け付けない行",
            message: "この行はコンパイルできない",
        },
        storyGotoMissing: {
            title: "ラベルがない",
            description: "シーンが宣言していないラベルを指す goto",
            message: "{label} へ飛ぶが、このシーンはそれを宣言していない",
        },
        storyLabelDuplicate: {
            title: "ラベルの重複",
            description: "同じラベルの宣言が 2 つあり、先に書いたほうが勝つ",
            message: "{label} は上ですでに宣言されているので、こちらには決して来ない",
        },
        storyLabelUnused: {
            title: "使われていないラベル",
            description: "どこからも飛んでこないラベル",
            message: "{label} へはどこからも飛んでこない",
        },
        storyJumpMissing: {
            title: "シーンがない",
            description: "プロジェクトに無いシーンを指す jump",
            message: "ストーリーにもう無いシーンへ飛んでいる",
        },
        storyEmptyChoice: {
            title: "空の選択",
            description: "プレイヤーが選べるものがない選択",
            message: "この選択に選択肢がない",
            messageEmptyOption: "この選択肢に文がない",
        },
        storyDeadEnd: {
            title: "行き止まり",
            description: "ある道では出ていくのに、別の道では末尾を越えて落ちるシーン",
            message: "ここでシーンの末尾を越えて進んでしまう",
        },
        storyUnreachableScene: {
            title: "到達しないシーン",
            description: "開始からはたどり着けないシーン",
            message: "このシーンにはどこからも到達しない",
        },
        storyEmptyScene: {
            title: "空のシーン",
            description: "中身のないシーン",
            message: "このシーンに行がない",
        },
        storyAppTagUnknown: {
            title: "知らないビルドバリアント",
            description: "プロジェクトに無いバリアントと比べている行",
            message: "\"{name}\" という名前のビルドバリアントはないので、この行はどのビルドにも入らない",
        },
        storyCutPointOrphan: {
            title: "バリアントの無いカットポイント",
            description: "ビルドバリアントが 1 つも無いまま書かれたカットポイント",
            // 行は間違いというより効かない状態なので、作者がしたことではなく、今それが何をするかを言う。
            // 打つ手はどちらも完全な答えなので、両方とも文に入れる。
            message: "このプロジェクトにはビルドバリアントが無いので、このカットポイントは何も終わらせない。バリアントを足すか、この行を消す",
        },
        storyCutPointUnreachable: {
            title: "届かないカットポイント",
            description: "どこからもたどり着けないシーンにあるカットポイント",
            message: "このシーンにはどこからも到達しないので、このカットポイントはどのビルドも終わらせない",
        },
        blueprintReferenceMissing: {
            title: "行き先が無い",
            description: "プロジェクトにもう無いものを名指すノード",
            // 総称の受け皿。解決できた種別にはそれぞれ専用の文が下にある。作者が手を打てない語が
            // まさに「何か」だから。
            message: "プロジェクトにもう無いものを名指している",
            messageSurface: "もう存在しないページを開く",
            messageStory: "もう存在しないストーリーを開始する",
            messageScene: "もう存在しないシーンを名指している",
            messageChoice: "もう存在しない選択肢を名指している",
            messageCharacter: "もう存在しないキャラクターを名指している",
            messageTextKey: "プロジェクトが宣言していないテキストキーを名指している",
        },
        blueprintUnreachableNode: {
            title: "到達しないノード",
            description: "そのグラフのどの入口からもたどり着けないノード",
            message: "このノードにはどこからも到達しないので、実行されない",
        },
        blueprintEmptyEvent: {
            title: "何もしないイベント",
            description: "実行するものが何もつながっていないイベントレイヤー",
            message: "このイベントは何も実行しない",
        },
        uiUnlocalizedText: {
            title: "ローカライズされていないテキスト",
            description: "第二の言語がある工程で、ウィジェットに直接書かれた文",
            message: "{text} はローカライズキーにつながっていない",
        },
        uiPageUnreachable: {
            title: "たどり着けないページ",
            description: "どこからも開かれず、埋め込まれてもいない、開始ページでもないページ",
            message: "このページを開くものがどこにもない",
        },
        uiEmptyBehavior: {
            title: "処理のないボタン",
            description: "押せるのに、聞いているものが何もないウィジェット",
            message: "押しても何も動かない",
        },
        blueprintSaveFieldEmpty: {
            title: "セーブ項目が空",
            description: "実行される Save Game ノードで、宣言済みのセーブ項目が空のまま",
            message: "{field} が空なので、このセーブには既定値が書き込まれる",
        },
        variablesUndeclared: {
            title: "宣言のない変数",
            description: "宣言せずに使っている変数",
            message: "{variable} は使われているが宣言されていない",
        },
        variablesUnused: {
            title: "使われていない変数",
            description: "宣言しただけで読み書きされない変数",
            message: "{variable} は宣言されているが使われていない",
        },
        variablesNameCollision: {
            title: "変数名の衝突",
            description: "同じ名前が 2 か所で宣言されている",
            message: "{variable} が永続変数として二度宣言されている",
        },
        variablesRandomOutsideAssignment: {
            title: "代入の外にある乱数",
            description: "値を残さず引き直されてしまう場所にある乱数",
            message: "{fn}() はこの条件を判定するたびに引き直されるので、確かめるたびに分岐が変わりうる。/set で一度だけ引き、その変数を判定する",
            messageChoiceOption: "{fn}() はメニューを描くたびに引き直されるので、この選択肢がちらつく。/set で一度だけ引き、その変数を判定する",
            messageInterpolation: "{fn}() はこの行を描くたびに引き直されるので、描き直すたびに値が変わる。/set で一度だけ引き、その変数を表示する",
        },
        textOverlong: {
            title: "長すぎる行",
            description: "ダイアログボックスに収まらない幅の行",
            message: "幅 {width} 桁で、上限の {max} を超えている",
        },
        textEmpty: {
            title: "空の行",
            description: "文のないダイアログ行",
            message: "この行に文がない",
        },
        localizationMissing: {
            title: "翻訳がない",
            description: "対象の言語に翻訳のない行",
            message: "{locale} の翻訳がない",
        },
        localizationStale: {
            title: "古い翻訳",
            description: "翻訳した後に原文が変わっている",
            message: "{locale} の翻訳が原文より古い",
        },
        localizationOrphan: {
            title: "宙に浮いた翻訳",
            description: "対応する行がもう無い翻訳",
            message: "対応する行のない {locale} の翻訳が {count} 件ある",
        },
        voiceMissing: {
            title: "ボイスがない",
            description: "ボイスを収録する言語で録音のない行",
            message: "{locale} の録音がない",
        },
        voiceStale: {
            title: "古いボイス",
            description: "録音した後に行が変わっている",
            message: "{locale} の録音が行より古い",
        },
        voiceOrphan: {
            title: "宙に浮いたボイス",
            description: "対応する行がもう無い録音",
            message: "対応する行のない {locale} の録音が {count} 件ある",
        },
        brandBrokenLink: {
            title: "切れた色のリンク",
            description: "解決できない配色の項目を指している色",
            // この 3 つは他の多くのルールと違い、自分で場所を名乗る。所見はプロジェクトの下に置かれ、
            // 隣の位置の列には何も出ないので、{where} だけが 1 つ 1 つを見分ける手がかりになる。
            message: "{where} が使っている {color} は配色に無い",
            messageChain: "{where} が使っている {color} は {missing} へつながっているが、その色は配色に無い",
            messageCycle: "{where} が使っている {color} は、リンクが自分自身に戻ってきている",
        },
    },
    message: {
        ruleFailed: "{rule} を実行できなかった",
        storyLoadFailed: "{story} を開けなかった",
    },
    category: {
        assets: "アセット",
        portability: "移植性",
        network: "ネットワーク",
        story: "ストーリー",
        blueprint: "ブループリント",
        // 内部の「Surface」ではなく、作者が目にする言葉で呼ぶ。ここはページとその上の部品の話。
        ui: "ページ",
        variables: "変数",
        text: "テキスト",
        localization: "ローカライズ",
        voice: "ボイス",
        // リンクのプロトコルではなく、作者が直しに行くパネルの名前を付ける。
        brand: "ブランドの配色",
    },
    severity: {
        error: "エラー",
        warning: "警告",
        info: "情報",
        off: "オフ",
    },
    report: {
        title: "問題",
        empty: "問題は見つからなかった",
        running: "検査している…",
        summary: "エラー {errors} 件、警告 {warnings} 件、情報 {infos} 件",
        filtered: "{total} 件中 {shown} 件",
        rerun: "もう一度実行",
        filterAll: "すべて",
        groupByRule: "ルール別",
        groupByLocation: "場所別",
        collapse: "折りたたむ",
        expand: "展開",
        collapseAll: "すべて折りたたむ",
        expandAll: "すべて展開",
        // 行番号の読み上げ。列そのものは数字だけにしてある。シーンエディタの行番号がそう出ていて、
        // 読み手はその 2 つを見比べるため。
        lineAria: "{line} 行目",
    },
    command: {
        runProject: "プロジェクトを検査",
        category: "検査",
    },
    console: {
        started: "検査を開始",
        finished: "エラー {errors} 件、警告 {warnings} 件（{duration}）",
        // 場所、次に何がおかしいか、最後にそう言っているルール。コンパイラの 1 行と同じ並びで、
        // 読み手が目で追う順でもある。重大度の枠は無い。コンソールは行ごとに別の列で出している。
        finding: "{location} {message}（{rule}）",
    },
    build: {
        blocked: "問題 {count} 件のためビルドを中止した",
        // パネル → ページ → 項目まで書く。この関門は既定で有効なので、このパネルを開いたことのない
        // 作者はその設定の存在を知らない。「検査の設定で」とだけ書くと探し回ることになる。
        blockedHint: "これは「プロジェクト → 検査 → ビルド前に検査」で変えられる",
        skipped: "プロジェクトの検査を省いた",
    },
    settings: {
        runOnBuild: "ビルド前に検査",
        runOnBuildHint: "製品ビルドの一部としてプロジェクトの検査を走らせる",
        failBuildOn: "ビルドを止める条件",
        failBuildOnError: "エラー",
        failBuildOnWarning: "警告とエラー",
        optionMaxChars: "最大の幅",
        optionCountMode: "数え方",
        // 短いのは必然。サイドバーのパネルでルールの下に入れ子で並ぶセレクトの選択肢なので、
        // 一文の長さのラベルは省略されて何も残らない。単位は桁で、問いは全角文字を何桁と数えるか。
        countModeEastAsianWidth: "全角は 2 桁",
        countModeCodePoints: "すべて 1 桁",
    },
} satisfies LocaleNamespace<"lint">;
