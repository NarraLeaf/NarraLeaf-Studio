import type { LocaleNamespace } from "../types";

/**
 * `lint` 日本語。プロジェクトの検査。ルールの名前と本文、レポートタブ、コンソールのチャンネル、
 * そして「プロジェクト ▸ プロジェクト」の設定。
 *
 * この名前空間が守る決まりが 2 つあり、どちらも別のテストが見張っている。
 *
 *  - ルールごとに `title`、`description`、`message` を camelCase のスラグの下に置く
 *    （`lint.rule.<slug>`）。登録済みのルールでどれかが欠けていると `registry.test.ts` が落ちる。
 *    ルールの変種の本文は `message` の隣に `message<Variant>` として並べる。
 *  - `title` は短い名詞句、`description` は 1 節で、ヒントのポップオーバーにしか出ない。
 *
 * 語調：`title` は文にしない（「ラベルがない」ではなく「ラベルの欠落」）。本文は今の状態だけを
 * 述べ、作者に語りかけない。動詞は書き言葉を採る（到達できない／実行されない／欠落）。
 * 話し言葉（たどり着けない・押しても動かない・行き止まり・宙に浮いた）は使わない。
 *
 * **本文は見つかった場所を名乗らない。** 本文を出す画面はどれも場所を隣に出す。レポートタブは
 * 専用の列で、ビルドのコンソールは `nonRedundantLintLocation` を通して。
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "使われていないアセット",
            description: "プロジェクトのどこからも参照されていないアセット",
            message: "{asset} はどこからも参照されていない",
            // 参照の索引がプロジェクト全体を覆えていないとき、一覧の代わりに出す 3 つ。
            // 場所を名指すことが要点で、「索引が不完全」とだけ言っても作者には見に行く先が無い。
            messageIndexUnresolved: "使われていないアセットを一覧にできない：{location} が指すアセットを特定できない",
            messageIndexUnreadable: "使われていないアセットを一覧にできない：{location} を読み込めない",
            messageIndexNotBuilt: "使われていないアセットを一覧にできない：プロジェクトを走査できない",
        },
        assetsMissing: {
            title: "アセットの欠落",
            description: "ライブラリに存在しないアセットを指す参照",
            message: "{location} が存在しないアセットを参照している",
        },
        assetsUnreadable: {
            title: "読み込めないアセット",
            description: "ファイルを読み込めない、またはデコードできない",
            message: "{asset} をデコードできない",
            messageMissingBytes: "{asset} をディスクから読み込めない",
        },
        assetsOversized: {
            title: "サイズ超過のファイル",
            description: "ビルドに含まれるファイルのうち、このプロジェクトが定めた上限を超えるもの",
            // 数字を 2 つとも文に入れる。このファイルが何 MB で、プロジェクトが何と言ったか。
            // 出どころの設定ページを開かなくても、この所見だけで手を打てるようにする。
            message: "{asset} は {size} で、ビルドに含められる上限 {limit} を超えている",
        },
        assetsGroupIncomplete: {
            title: "未完成のアセットセット",
            description: "宣言したバリアントのいずれかが、ちょうど 1 つのファイルに解決しないセット",
            // バリアントは構成するタグの形で示す。そのタグをファイルに書くことが対処だから。
            // 解決するはずのファイル名は書かない。そのファイルはまだ存在しない。
            message: "{set} の {variant} に対応するファイルがない",
            messageAmbiguous: "{set} の {variant} に {count} 個のファイルが対応している",
            messageResidency: "{set} の {axis} は実行時に解決されるが、ビルド時に解決される {outerAxis} の内側にある",
            messageDeclaration: "{set} は解決できるバリアントを宣言していない",
            messageFallback: "{set} は既定のバリアントを指定していない",
        },
        portabilityAssetName: {
            title: "安全でないファイル名",
            description: "一部のファイルシステムが受け付けない文字や名前",
            message: "{asset} は一部のプラットフォームで書き出せない",
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
        portabilityVfxAlpha: {
            title: "透過を含むオーバーレイ素材",
            description: "選んだビルド対象の一部が透過を保持しないオーバーレイ素材",
            message: "{asset} は {platform} でステージを覆う",
        },
        networkFetchNotAllowlisted: {
            title: "許可一覧にないアドレス",
            description: "このプロジェクトが許可していないアドレスを指す Fetch ノード",
            message: "{url} はこのプロジェクトのネットワーク要求許可一覧にない",
        },
        networkFetchDisallowed: {
            title: "ネットワーク許可のないネットワークノード",
            description: "ネットワークポリシーが「使わない」のプロジェクトにあるネットワークノード",
            message: "{blueprint} はネットワーク要求を行うが、このプロジェクトのネットワークポリシーが許可していない",
        },
        storyInvalidCommand: {
            title: "無効なコマンド",
            description: "コンパイラが受け付けない行",
            message: "この行はコンパイルできない",
        },
        storyGotoMissing: {
            title: "ラベルの欠落",
            description: "シーンが宣言していないラベルを指す goto",
            message: "ジャンプ先の {label} はこのシーンで宣言されていない",
        },
        storyLabelDuplicate: {
            title: "ラベルの重複",
            description: "同じラベルの宣言が 2 つあり、到達するのは先に書いたほうだけ",
            message: "{label} は上で既に宣言されているため、この宣言には到達しない",
        },
        storyLabelUnused: {
            title: "使われていないラベル",
            description: "どこからもジャンプされないラベル",
            message: "{label} へジャンプする箇所がない",
        },
        storyJumpMissing: {
            title: "シーンの欠落",
            description: "プロジェクトに存在しないシーンを指す jump",
            message: "ジャンプ先のシーンはストーリーに存在しない",
        },
        storyEmptyChoice: {
            title: "空の選択",
            description: "プレイヤーが選べる選択肢のない選択",
            message: "この選択に選択肢がない",
            messageEmptyOption: "この選択肢にテキストがない",
        },
        storyDeadEnd: {
            title: "子ノードなし",
            description: "一部の経路はシーンから出ていくが、末尾の行に子ノードがない経路が残っているシーン",
            message: "この行に子ノードがなく、ここでシーンの末尾を越える",
        },
        storyUnreachableScene: {
            title: "到達できないシーン",
            description: "開始地点から到達できないシーン",
            message: "このシーンへ到達する経路がない",
        },
        storyEmptyScene: {
            title: "空のシーン",
            description: "内容のないシーン",
            message: "このシーンに行がない",
        },
        storyAppTagUnknown: {
            title: "不明なビルドバリアント",
            description: "プロジェクトに存在しないバリアントと比べている行",
            message: "「{name}」という名前のビルドバリアントはないため、この行はどのビルドにも入らない",
        },
        storyRowsAfterEnding: {
            title: "エンディングより後の行",
            description: "同じ並びの /ending 行より後に書かれ、決して再生されない行",
            message: "この行はエンディングより後にあり、決して再生されない。エンディングより前に移すか、削除する",
        },
        storyEndingNameDuplicate: {
            title: "同じ名前の 2 つのエンディング",
            description: "表示名を共有しているエンディングが複数ある",
            message: "別のエンディングも「{name}」という名前である。エンディングを並べる画面には同じ名前が 2 回出る",
        },
        storyCutPointOrphan: {
            title: "ビルドバリアントのないカットポイント",
            description: "ビルドバリアントが 1 つも無いまま書かれたカットポイント",
            // 行は間違いというより効かない状態なので、作者がしたことではなく、今それが何をするかを言う。
            // 打つ手はどちらも完全な答えなので、両方とも文に入れる。
            message: "このプロジェクトにはビルドバリアントがないため、このカットポイントは何も終わらせない。バリアントを追加するか、この行を削除する",
        },
        storyCutPointUnreachable: {
            title: "到達できないカットポイント",
            description: "到達できないシーンにあるカットポイント",
            message: "このシーンへ到達する経路がないため、このカットポイントはどのビルドも終わらせない",
        },
        storyStageObjectMissing: {
            title: "存在しないステージオブジェクト",
            description: "シーン内のどの行も作成していないオブジェクトを操作する行",
            message: "{object} を作成する行がないため、この行には操作する対象がない",
            // キャラクターは作成するものではなく登場させるものなので、変わるのは動詞だけ。
            messageCharacter: "{object} を登場させる行がないため、この行には操作する対象がない",
        },
        storyDeclaredNeverShown: {
            title: "表示されないステージオブジェクト",
            description: "作成行が宣言した対象を表示する行がない",
            message: "{object} はこの行で宣言され、表示する行がない",
        },
        storyStageObjectDuplicate: {
            title: "ステージオブジェクトの重複",
            description: "同じステージ名を作成する行が 2 つあり、後の行は先の行のものを使う",
            message: "{object} は上で既に作成されているため、この行はそちらを操作する",
        },
        storyCharacterMissing: {
            title: "存在しないキャラクター",
            description: "プロジェクトに存在しないキャラクターを指定した行",
            // 文中に対象を出さない。参照が解決しないとき残るのは保存された id だけで、それは UUID -
            // 作者がプロジェクト内を検索できない語を報告に出すことになる。
            message: "この行が指すキャラクターはプロジェクトに存在しない",
        },
        storyTransitionUnavailable: {
            title: "利用できないトランジション",
            description: "このバージョンでは再生できないトランジションを指定した行",
            // 保存された語をそのまま出す。どのメニューにも残っていない以上、作者に残る手がかりはこれだけ。
            message: "トランジション {transition} は利用できないため、この変化は切り替えで再生される",
        },
        blueprintReferenceMissing: {
            title: "参照先の欠落",
            description: "プロジェクトに存在しない対象を指すノード",
            // 総称の受け皿。解決できた種別にはそれぞれ専用の文が下にある。作者が手を打てない語が
            // まさに「対象」だから。
            message: "指している対象がプロジェクトに存在しない",
            messageSurface: "開く対象のページが存在しない",
            messageStory: "開始する対象のストーリーが存在しない",
            messageScene: "指しているシーンが存在しない",
            messageChoice: "指している選択肢が存在しない",
            messageEnding: "指しているエンディングが存在しない",
            messageCharacter: "指しているキャラクターが存在しない",
            messageTextKey: "指しているテキストキーはプロジェクトで宣言されていない",
            messageDlc: "指している DLC はプロジェクトに存在しない",
            messageInputAction: "指している入力アクションはプロジェクトで宣言されていない",
        },
        blueprintElementRefMissing: {
            title: "ウィジェットの欠落",
            description: "プロジェクトに存在しないウィジェットに結び付いたノード",
            message: "結び付いているウィジェットが存在しない",
        },
        blueprintFnTargetMissing: {
            title: "関数の欠落",
            description: "呼び出す関数がこのスコープに存在しない Call Fn ノード",
            // シグネチャのスナップショットを持たない呼び出し用の受け皿。残るのは id の対だけで、
            // それを報告に出すのは作者がプロジェクト内を検索できない語を出すことになる。
            message: "呼び出している関数がこのスコープに存在しない",
            messageNamed: "呼び出している「{name}」がこのスコープに存在しない",
        },
        blueprintUnreachableNode: {
            title: "到達できないノード",
            description: "グラフのどの入口からも到達できないノード",
            message: "このノードへ到達する経路がなく、実行されない",
        },
        blueprintDlcEntranceUnguarded: {
            title: "ガードのない DLC 入口",
            description: "DLC のストーリーを開始しているが、その DLC があるかどうかをどこも確かめていない",
            message: "このグラフには DLC がインストール済みか確かめるノードがない",
        },
        blueprintEmptyEvent: {
            title: "空のイベント",
            description: "実行する内容が接続されていないイベントレイヤー",
            message: "このイベントは何も実行しない",
        },
        uiUnlocalizedText: {
            title: "ローカライズされていないテキスト",
            description: "第二の言語があるプロジェクトで、ウィジェットに直接書かれたテキスト",
            message: "{text} はローカライズキーに紐づけられていない",
        },
        uiPageUnreachable: {
            title: "到達できないページ",
            description: "どこからも開かれず、埋め込まれてもおらず、開始ページでもないページ",
            message: "このページを開く箇所がない",
        },
        uiEmptyBehavior: {
            title: "動作の割り当てがないボタン",
            description: "クリックできるが、動作が何も割り当てられていないウィジェット",
            message: "クリックしても何も実行されない",
        },
        uiComponentMissing: {
            title: "存在しないコンポーネント",
            description: "プロジェクトにないコンポーネントのインスタンス",
            message: "このインスタンスはプロジェクトにないコンポーネントを参照している",
        },
        uiFrameTargetMissing: {
            title: "存在しない埋め込みページ",
            description: "プロジェクトにないページを埋め込んでいるページウィジェット",
            message: "このページウィジェットはプロジェクトにないページを埋め込んでいる",
        },
        uiListItemFieldMissing: {
            title: "項目が見つかりません",
            description: "描画元のリストが宣言していない項目に紐づいたウィジェット",
            message: "リストが宣言していない項目に紐づいているため、どの行も同じ内容になります",
        },
        uiGestureAnsweredTwice: {
            title: "二重に反応する操作",
            description: "独自のポインター処理を持つウィジェットが、同じ操作に反応するページに置かれている",
            message: "このページの {action} とこのウィジェットが同じ操作に反応するため、両方が実行される",
        },
        blueprintSaveFieldEmpty: {
            title: "未入力のセーブ項目",
            description: "実行される Save Game ノードで、宣言済みのセーブ項目が未入力",
            message: "{field} が未入力のため、このセーブには既定値が書き込まれる",
        },
        variablesUndeclared: {
            title: "宣言のない変数",
            description: "宣言されないまま使われている変数",
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
            message: "{variable} が永続変数として 2 回宣言されている",
        },
        variablesRandomOutsideAssignment: {
            title: "代入の外にある乱数",
            description: "値が残らず引き直される位置にある乱数",
            message: "{fn}() はこの条件を判定するたびに引き直されるため、判定のたびに分岐が変わりうる。/set で一度だけ引き、その変数を判定する",
            messageChoiceOption: "{fn}() はメニューを描くたびに引き直されるため、この選択肢がちらつく。/set で一度だけ引き、その変数を判定する",
            messageInterpolation: "{fn}() はこの行を描くたびに引き直されるため、描き直すたびに値が変わる。/set で一度だけ引き、その変数を表示する",
        },
        textOverlong: {
            title: "長すぎる行",
            description: "ダイアログボックスに収まらない幅の行",
            message: "幅 {width} 桁で、上限の {max} を超えている",
        },
        textEmpty: {
            title: "空の行",
            description: "テキストのないダイアログ行",
            message: "この行にテキストがない",
        },
        localizationMissing: {
            title: "翻訳の欠落",
            description: "対象の言語に翻訳のない行",
            message: "{locale} の翻訳がない",
        },
        localizationStale: {
            title: "古い翻訳",
            description: "翻訳した後に原文が変わっている",
            message: "{locale} の翻訳が原文より古い",
        },
        localizationMarkup: {
            title: "訳文に文字装飾がない",
            description: "原文には装飾があり、訳文はそれを持たずに表示される",
            message: "{locale} の訳文がこの行の装飾を持っていない",
        },
        localizationOrphan: {
            title: "対応する行のない翻訳",
            description: "対応する行が存在しない翻訳",
            message: "対応する行のない {locale} の翻訳が {count} 件ある",
        },
        voiceMissing: {
            title: "ボイスの欠落",
            description: "ボイスを収録する言語で録音のない行",
            message: "{locale} の録音がない",
        },
        voiceStale: {
            title: "古いボイス",
            description: "録音した後に行が変わっている",
            message: "{locale} の録音が行より古い",
        },
        voiceOrphan: {
            title: "対応する行のない録音",
            description: "対応する行が存在しない録音",
            message: "対応する行のない {locale} の録音が {count} 件ある",
        },
        brandBrokenLink: {
            title: "切れた色のリンク",
            description: "解決できない配色の項目を指している色",
            // この 3 つは他の多くのルールと違い、自分で場所を名乗る。所見はプロジェクトの下に置かれ、
            // 隣の位置の列には何も出ないので、{where} だけが 1 つ 1 つを見分ける手がかりになる。
            message: "{where} が使っている {color} は配色に無い",
            messageChain: "{where} が使っている {color} は {missing} へつながっているが、その色は配色に無い",
            messageCycle: "{where} が使っている {color} は、リンクが自分自身に戻っている",
        },
        typographyGlyphCoverage: {
            title: "グリフ不足",
            description: "プロジェクトのどのフォントにも無い文字を使っている",
            message: "プロジェクトのフォントに「{character}」が無い（{count} 箇所）",
            messageInLanguage: "{language}でプロジェクトのフォントに「{character}」が無い（{count} 箇所）",
            messageMore: "他に {count} 文字、プロジェクトのフォントに無い",
            messageMoreInLanguage: "{language}で他に {count} 文字、プロジェクトのフォントに無い",
            messageUnreadable: "{font} を読み取れないため、グリフ確認を行わなかった",
            messageUnloadable: "{font} は .{format} フォントで、ゲームでは描画できない",
        },
        typographyLocaleNoFont: {
            title: "フォントの無い言語",
            description: "プロジェクトのフォントがすべて他の言語に限定されている",
            message: "{language}に使えるプロジェクトフォントが無い",
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
        typography: "タイポグラフィ",
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
        running: "検査中…",
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
        blockedHint: "「プロジェクト ▸ プロジェクト ▸ ビルド前に検査」で変更できる",
        skipped: "プロジェクトの検査を省略した",
    },
    settings: {
        runOnBuild: "ビルド前に検査",
        runOnBuildHint: "製品ビルドの一部としてプロジェクトの検査を実行する",
        failBuildOn: "ビルドを止める条件",
        failBuildOnError: "エラー",
        failBuildOnWarning: "警告とエラー",
        optionMaxChars: "最大幅",
        optionCountMode: "数え方",
        // 短いのは必然。サイドバーのパネルでルールの下に入れ子で並ぶセレクトの選択肢なので、
        // 一文の長さのラベルは省略されて何も残らない。単位は桁で、問いは全角文字を何桁と数えるか。
        countModeEastAsianWidth: "全角は 2 桁",
        countModeCodePoints: "すべて 1 桁",
    },
} satisfies LocaleNamespace<"lint">;
