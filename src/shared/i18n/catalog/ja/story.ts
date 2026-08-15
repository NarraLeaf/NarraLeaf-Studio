import type { LocaleNamespace } from "../types";

/**
 * `story` 日本語。ストーリーのパネル（一覧とアウトライン）と、シーンエディタ。
 * 地の文と台詞の行、リッチテキストの道具、キャラクターやレイヤーや対象の選択、
 * 停止と値の差し込みのポップオーバー、そして実況プレビュー。
 */
export const story = {
    panel: {
        storiesCount: "ストーリー（{count}）",
        newStory: "新規ストーリー",
        emptyStories: "このプロジェクトにストーリーがない",
        storyActions: "ストーリーの操作",
        setDefault: "既定にする",
        outline: "アウトライン",
        newChapter: "新規チャプター",
        newSceneInChapter: "チャプターに新規シーン",
        loadingStory: "ストーリーを読み込んでいる…",
        chapterTitle: "{name}（{count}）",
        emptyScenes: "シーンがない",
        lineCount: {
            other: "{count} 行",
        },
        sceneActions: "シーンの操作",
        chapterActions: "チャプターの操作",
        setEntryScene: "開始シーンにする",
        documentUnavailable: "ストーリーのドキュメントを使えない",
        newStoryPlaceholder: "ストーリー名を入力",
        newChapterPlaceholder: "チャプター名を入力",
        newSceneTitle: "新規シーン",
        newScenePlaceholder: "シーン名を入力",
        deleteStoryConfirm: "ストーリー「{name}」を削除するか",
        deleteStoryDetail: "このストーリーのドキュメントをプロジェクトから取り除く",
        deleteChapterConfirm: "チャプター「{name}」を削除するか",
        // 数を出す。行は開くまで中身を言わないうえ、シーンはチャプターと一緒に消えるから。
        deleteChapterDetail: {
            other: "中の {count} 個のシーンも一緒に削除される",
        },
        deleteSceneConfirm: "シーン「{name}」を削除するか",
        deleteSceneDetail: "このシーンとその中の行を取り除く。ここへの飛び先は解決できなくなる",
    },
    // シーンをテキストファイルとして Studio の外に出し、また戻す。`parseError` と `diag` は
    // 変換側のコードをキーにしているので、新しいコードは、生の識別子として作者に届く前に
    // 突き合わせのテストで落ちる。
    script: {
        exportScene: "スクリプトとして書き出す…",
        exportStory: "ストーリーをスクリプトとして書き出す…",
        import: "スクリプトを読み込む…",
        exportTitle: "スクリプトとして書き出す",
        exportAction: "書き出す",
        mode: {
            roundtrip: "往復用",
            roundtripDetail: "シーンのデータを持つので、読み込み直せる",
            review: "確認用",
            reviewDetail: "文だけ。読みやすく、差分も取りやすい。読み込み直せない",
        },
        exported: "{path} に書き出した",
        importTitle: "スクリプトを読み込む",
        importAction: "読み込む",
        imported: {
            other: "{count} 個のシーンを読み込んだ",
        },
        nothingToImport: "このファイルはシーンを持っていない",
        storyMismatch: "このファイルは別のストーリーから書き出されている",
        stale: "このシーンは書き出しの後に変わっている。読み込むとその変更は失われる",
        sceneMissing: "このシーンはもうストーリーに無いので、読み込まない",
        // 元に戻すはシーンエディタごとなので、複数シーンの読み込みは一部だけ取り消せることがある。
        noUndo: "ここからの読み込みは元に戻せない",
        noUndoSome: {
            other: "このうち {count} 個のシーンは、読み込んだ後に元に戻せない",
        },
        // どちらの失敗もプロジェクトがどうなったかを言う。「エラーが発生しました」では、
        // 断られた読み込みと途中まで書かれた読み込みを見分けられない。
        planFailed: "このスクリプトは読み込みの準備ができなかった。何も変わっていない",
        importFailed: "「{scene}」で読み込みが止まった。{total} 個中 {applied} 個のシーンを書き、残りはそのまま",
        line: "{line} 行目",
        stat: {
            unchanged: "変更なし {count}",
            edited: "編集 {count}",
            added: "追加 {count}",
            removed: "削除 {count}",
            cloned: "複製 {count}",
            moved: "移動 {count}",
        },
        parseError: {
            notAScript: "このファイルはストーリーのスクリプトではない",
            unsupportedVersion: "このスクリプトは新しいバージョンの Studio が書いたもの",
            dataMissing: "このスクリプトはシーンのデータを持たないので読み込めない。確認用の書き出しは読むだけのもの",
            dataCorrupt: "このスクリプトのシーンのデータは壊れていて読めない",
            malformed: "このスクリプトを読めなかった",
        },
        diag: {
            opaqueWithoutAnchor: "アクションの行が印を失ったので、そのアクションを復元できなかった",
            unknownAnchor: "印が、このスクリプトに無い行を指している",
            shapeMismatchAction: "アクションの行が文に書き換えられていた。アクションを残し、その編集は捨てた",
            shapeMismatchText: "文の行がアクションの行に書き換えられていた。文を残し、その編集は捨てた",
            duplicateAnchor: "行が複製されていた。複製には新しい識別子を与えた",
            unknownRun: "書式の印が、このスクリプトに無い書式を指している",
            unplaceableLine: "新しい行の置き場所がここには無い",
            speakerUnresolved: "この行はキャラクターと結びついていないので、元の話者名を残した。文のほうは変わっている",
        },
    },
    // NarraLang の書き出し。ストーリーをスクリプトとして読み、差分を取るためのもの。一方向なので、
    // スクリプトで言えない行は拒まずに報告し、ファイルはどちらにせよ書く。`reason` は印刷側の
    // コードをキーにしているので、新しいコードは、生の識別子として作者に届く前に突き合わせの
    // テストで落ちる。
    narralang: {
        exportScene: "NarraLang として書き出す…",
        exportStory: "ストーリーを NarraLang として書き出す…",
        sceneMissing: "このシーンはもうストーリーに無い",
        reportTitle: "スクリプトの書き方が無い行",
        reportSummary: {
            other: "{count} 行にスクリプトの書き方が無い。ファイルはその内容をすべては持っていない",
        },
        reason: {
            blueprintAction: "この行はブループリントが実行する。ブループリントにスクリプトの書き方は無い",
            blueprintCondition: "この条件はブループリントが決める",
            blueprintInterpolation: "文の中の値をブループリントが計算する",
            inlineEvent: "文が、表示していく途中で発生するイベントを持っている",
            invalidRow: "この行のコマンドを読めなかったので、そのまま書き出した",
            customTransform: "この動きはコマ単位で作られているか、スクリプトが名前を持たないプロパティを含む",
            customTransition: "この切り替えは、スクリプトが名前を持たないプロパティを含む",
            effectProps: "この効果は、スクリプトが名前を持たないプロパティを含む",
            unresolvedRef: "この行が指しているものはもう無い",
            unknownPayload: "この種類の行はスクリプトがまだ扱わない",
        },
    },
    // 文のかたまりをシーンに貼り付ける。ウィザードが尋ねるのは誰が話しているかの 1 点だけで、
    // 答えはプロジェクトごとに覚えるので、第 2 章は第 1 章の判断が入った状態で開く。
    paste: {
        title: "行として貼り付け",
        action: "貼り付け",
        totals: "台詞 {dialogue} · 地の文 {narration} · 新しいキャラクター {created}",
        lineCount: {
            other: "{count} 行",
        },
        moreRows: {
            other: "…ほか {count} 行",
        },
        noSpeakers: "話者の目印がない。すべての行が地の文になる",
        targetFor: "{label} が誰か",
        willBeCreated: "作成される",
        separator: {
            none: "話者なし",
            colon: "名前: 本文",
            fullwidthColon: "名前：本文",
            dash: "名前 ー 本文",
            lenticular: "【名前】本文",
            cornerBracket: "「名前」本文",
            tab: "名前 ⇥ 本文",
            regex: "カスタム",
        },
        regexPlaceholder: "^(?<speaker>[^:]+):\\s*(?<text>.+)$",
        problem: {
            invalidRegex: "このパターンはまだ正しくない",
            missingGroups: "パターンには (?<speaker>…) と (?<text>…) の両方が要る",
        },
        presetNamePlaceholder: "この区切りに名前を付ける",
        savePreset: "保存",
        forgetPreset: "このプリセットを忘れる",
        target: {
            tempSpeaker: "名前だけ",
            createCharacter: "新しいキャラクター",
            notASpeaker: "話者ではない",
            existing: "キャラクター",
        },
        // ウィザードを出さない素の経路（Ctrl+Shift+V）。何をするつもりかを見せる画面が無い。
        bulkConfirm: {
            other: "{count} 行を貼り付けるか",
        },
        bulkConfirmDetail: "現在の行の下に、1 回分の取り消しとして足す",
        scriptFile: "これはストーリーのスクリプト。戻すには「スクリプトを読み込む」を使う",
    },
    flow: {
        tabTitle: "シーンフロー",
        tabTitleNamed: "シーンフロー：{name}",
        node: {
            blocks: {
                other: "{count} ブロック",
            },
        },
        badge: {
            entry: "開始シーン",
            unreachable: "開始シーンからは到達しない",
            selfJump: {
                other: "このシーンへ戻る飛び先 {count} 件",
            },
            dangling: {
                other: "行き先の無い飛び先 {count} 件",
            },
        },
        // 展開したシーンのノードの中に描かれる、選択肢ごとの分岐の行。「分かれ目」は問いのほうで、
        // 選択や if の群。「枝」はそれに答える 1 本。
        branch: {
            forkChoice: "選択",
            forkCondition: "条件",
            // わざと「行き止まり」とは呼ばない。中の分かれ目のほうが飛んでいる枝も素通りするし、
            // ただ 1 行喋ってシーンに戻る枝も素通りする。
            fallsThrough: "続く",
            fallsThroughTitle: "自分では飛ばない。分かれ目の先へシーンが続く",
            forkCount: {
                other: "{count} 本の枝",
            },
            expand: "枝を表示",
            collapse: "枝を隠す",
        },
        // ルートのレール。グラフから導いたエンディング（そこから出られないシーン）と、
        // そこへ至るすべての選択の道。
        route: {
            title: "ルート",
            show: "ルートを表示",
            hide: "ルートを隠す",
            count: {
                other: "{count} ルート",
            },
            // 探索が上限に当たった後の見出しの数。この「+」がこのキーの理由そのもの。
            countTruncated: "{count}+ ルート",
            // 一覧が打ち切られていること、そして下のどの数もその打ち切られた一覧の話であることを言う。
            // 4000 本のうち 200 本を出しているレールは、黙っていると「これで全部」と読まれる。
            truncated: "{count} ルートで打ち切った。以下の数と注記はその範囲だけを見ている",
            noEntryScene: "開始シーンが無いので、ルートも無い",
            noRoutes: "ルートがない",
            noDecisions: "選択なし",
            // 道はエンディングでないシーンでも止まりうるし、それをエンディングと呼ぶのは嘘になる。
            stopsHere: "ここで止まる",
            stopsHereTitle: "道はここで止まるが、ここはエンディングではない。訪れたシーンへ戻ったか、選択肢の先に何も書かれていない",
            diagnostics: {
                unreachableEndings: {
                    other: "どのルートも届かないエンディング {count} 件",
                },
                deadBranches: {
                    other: "どのルートにも乗らない選択肢 {count} 件",
                },
            },
        },
        // 変数のフォーカス。シーンのチップは *到着時* の値で、そのシーン自身の書き込みより前。
        // だからここのどの文も、最終的な値と読めてはならない。
        variable: {
            none: "変数のフォーカスなし",
            hintArrival: "シーンのチップは到着時の値",
            arrivalTitle: "到着時の値。このシーン自身の変更より前",
            finalTitle: "このルートの終わりの値",
            rangeChip: "{name} {min}-{max}",
            valueChip: "{name} {value}",
            unknownChip: "{name} ?",
        },
        summary: {
            scenes: {
                other: "{count} シーン",
            },
            jumps: {
                other: "{count} 件の飛び先",
            },
            dangling: {
                other: "壊れた飛び先 {count} 件",
            },
            unreachable: {
                other: "到達しない {count} 件",
            },
        },
        hint: {
            openScene: "シーンをダブルクリックすると開く",
            // 操作が何を *する* かを言う。この図はわざと飛び先を書かないので、書かれると思っている
            // 作者には、開いたエディタが本題ではなく回り道に見えてしまう。
            connect: "シーンどうしをドラッグすると飛び先を書く",
        },
        // 図の上の線と、その裏にある飛び先。
        edge: {
            reveal: "これらの飛び先を表示",
            disconnect: "つながりを削除",
            confirmRemove: {
                other: "{source} から {target} への飛び先 {count} 件をすべて削除するか",
            },
            // 図からは見えない 1 点を言う。飛び先はシーンの中の行で、分かれ目の下にあることもあり、
            // つながりを消すとはその行を消すこと。
            confirmRemoveDetail: {
                other: "{source} から飛び先 {count} 件をすべて取り除く。シーンエディタで元に戻せる",
            },
            confirmRemoveAction: "飛び先を削除",
        },
        action: {
            resetLayout: "配置をリセット",
            openFlow: "シーンフローを開く",
        },
        empty: {
            noStory: "図にするストーリーがない",
            noScenes: "このストーリーにはまだシーンがない",
        },
    },
    stage: {
        notOnStage: "舞台に出ていない",
        builtin: "組み込み",
    },
    targetField: {
        label: "対象",
        notOnStageTitle: "このシーンの前の行で作られていない。すでにある表示要素を選ぶ",
        placeholder: "表示要素を選ぶ…",
        search: "舞台の表示要素を検索",
        noMatch: "一致するものがない",
        kind: {
            character: "キャラクター",
            image: "画像",
            text: "テキスト",
            layer: "レイヤー",
        },
    },
    layerField: {
        label: "レイヤー",
        defaultName: "表示要素のレイヤー",
        notOnStageTitle: "この名前のレイヤーはこのシーンの前の行で宣言されていない。すでにあるレイヤーを選ぶ",
        hint: "レイヤー",
        createNew: "レイヤーを新規作成",
    },
    appearance: {
        noPoses: "このキャラクターにはまだポーズがない",
        noAxes: "このキャラクターにはまだレイヤーの軸がない",
        unchanged: "変更なし",
        appearance: "見た目",
        default: "既定",
        preview: "プレビュー",
    },
    pause: {
        title: "停止",
        clickToProceed: "クリックで進む",
        waitFor: "待つ長さ",
        seconds: "秒",
        clickHint: "プレイヤーがクリックするまで待つ",
        remove: "停止を取り除く",
    },
    ruby: {
        title: "ルビ",
        placeholder: "読み",
        remove: "ルビを取り除く",
    },
    /**
     * 印の付いた語を右クリックしたときに開くパネル。
     *
     * `addToDictionary` はプロジェクトの辞書であって、この機体のものではない：語はリポジトリと一緒に旅をするので、同じ台本を書く全員が同じ綴りになる。
     */
    spellcheck: {
        checking: "候補を探している…",
        noSuggestions: "候補なし",
        addToDictionary: "プロジェクトの辞書に追加",
    },
    interpolation: {
        title: "値を差し込む",
        kindVariable: "変数",
        kindBlueprint: "ブループリント",
        selectVariable: "変数を選ぶ…",
        noVariables: "宣言された変数がない",
        storyValueTitle: "ストーリー値",
    },
    richText: {
        collapse: "リッチテキストの道具を畳む",
        bold: "太字",
        italic: "イタリック",
        textColor: "文字色 {color}",
        moreColors: "プロジェクトのパレットから他の色",
        insertPause: "停止を差し込む（クリックを待つ）",
        insertValue: "行の中に値を差し込む",
        insertValueHint: "行の中に値を差し込む（変数またはブループリント）",
        insertExpression: "式による変更を差し込む",
        ruby: "ルビ",
        rubyHint: "ルビ（振りたい語を選んでから）",
        tools: "リッチテキストの道具",
        pauseClick: "停止（クリックを待つ）",
        pauseSeconds: "停止 {seconds} 秒",
        insertedValue: "差し込んだ値：{name}",
        valueFallback: "値",
        expressionEvent: "式による変更",
        soundEvent: "効果音",
    },
    inlineEvent: {
        title: "行の中のイベント",
        noCharacter: "この行にキャラクターがいない",
        sound: "効果音",
    },
    actionCreator: {
        starred: "お気に入り",
        searchPlaceholder: "アクションを検索",
        noActions: "アクションが見つからない",
        scopedTo: "{name} のアクション",
        addStarred: "お気に入りに追加",
        removeStarred: "お気に入りから外す",
    },
    music: {
        missingAudio: "音声が見つからない",
        none: "音楽なし",
    },
    background: {
        missingImage: "画像が見つからない",
        none: "背景なし",
        unassigned: "未指定",
    },
    /**
     * コマンドラインのカーソルの後ろに薄く出る `<変数名>` の名前。`StoryCommandParam.hint`
     * （無ければパラメータの `name`）をキーにするので、同じスロットはどのコマンドでも同じに読める。
     * 山括弧は描画側が付けるので、ここには書かない。
     */
    paramHint: {
        // 変数とロジック
        variableName: "変数名",
        variable: "変数",
        defaultValue: "初期値",
        valueType: "型",
        description: "説明",
        expressionValue: "値または式",
        condition: "条件",
        amount: "量",
        times: "回数",
        // 舞台とメディア
        character: "キャラクター",
        speaker: "話者",
        form: "表情",
        motion: "モーション",
        skin: "スキン",
        puppetParam: "パラメータ",
        puppetParamValue: "数値",
        imageAsset: "画像",
        imageOrColor: "画像または色",
        videoAsset: "動画",
        audioAsset: "音声",
        objectName: "名前",
        content: "内容",
        target: "対象",
        lineText: "テキスト",
        labelName: "ラベル",
        scene: "シーン",
        track: "オーディオトラック",
        appTag: "ビルドバリアント",
        displayName: "表示名",
        seekTime: "秒",
        // カメラ
        cameraOperation: "パン / ズーム / 回転 / 暗く / モーション / リセット",
        cameraAmount: "量または位置",
        // 修飾
        duration: "秒",
        transition: "トランジション",
        reveal: "現し方",
        placement: "位置",
        waitFor: "秒またはクリック",
        // 値のキーがそのまま名前として読めるスロット。明示的な `hint` を持たず、ここに落ちてくる。
        fade: "フェード秒",
        loop: "ループ",
        vol: "音量",
        volume: "音量",
        rate: "速度",
        muted: "消音",
        color: "色",
        hold: "保持秒",
        opacity: "不透明度",
        size: "文字サイズ",
        z: "重ね順",
    },

    /**
     * コマンドラインの列挙値をどう綴るか。語彙の名前空間 3 つ
     * （`command.*.label`、`paramHint.*`、これ）の最後の 1 つ。
     *
     * 英語はどの値もそのまま同じ綴りにしてある。`localizedEnums.ts` は正規の値をなぞるだけの
     * 綴りを落とすので、訳していない項目は必ずパーサが受け付ける語に落ちる。
     */
    enumValue: {
        // トランジションの語（`t=`）
        fade: "フェード",
        slide: "スライド",
        "slide-left": "左スライド",
        "slide-right": "右スライド",
        "slide-up": "上スライド",
        "slide-down": "下スライド",
        circle: "円",
        wipe: "ワイプ",
        iris: "アイリス",
        blur: "ぼかし",
        blinds: "ブラインド",
        "barn-door": "観音開き",
        clock: "時計",
        fan: "扇",
        dots: "ドット",
        black: "暗転",
        darkness: "暗さ",
        none: "なし",
        // 表示と非表示で `t=` が届く、トランジションの語では名指しできない変形のプリセット。
        scale: "拡大縮小",
        opacity: "不透明度",
        // 位置（`at=`）とカメラの位置を表す値
        left: "左",
        center: "中央",
        right: "右",
        // カメラの操作
        pan: "パン",
        zoom: "ズーム",
        rotate: "回転",
        darken: "暗く",
        motion: "運びカメラ",
        reset: "リセット",
        // 変数の型
        boolean: "真偽値",
        number: "数値",
        string: "文字列",
        // 固有名詞なので日本語でもそのまま。大文字小文字を畳むと元の語と同じになり、語彙表は落とす。
        json: "JSON",
    },

    /**
     * 数値に添える単位。上の 3 つとまったく同じ規則で作られ、同じ規則で落ちる
     * （`localizedUnits.ts`）。
     */
    unit: {
        /** 秒。語彙にある長さ、フェード、保持はすべてこれで測る。 */
        s: "秒",
    },

    view: {
        density: "表示の密度",
        "density.compact": "詰める",
        "density.standard": "標準",
        "density.comfortable": "ゆったり",
        /** シーンがどの種類の行を出すか。区分の名前は読むための見出しで、コマンドの分類ではない。 */
        filter: {
            title: "行を絞り込む",
            /** パネルの先頭の 2 つ。1 つはプリセット、もう 1 つは抜け道。 */
            dialogueOnly: "台詞だけ",
            clear: "絞り込みを解除",
            sectionScript: "台本",
            sectionStaging: "演出",
            sectionCast: "配役",
            facet: {
                dialogue: "台詞",
                narration: "地の文",
                choice: "選択",
                note: "メモ",
                character: "キャラクター",
                stage: "舞台",
                camera: "カメラ",
                scene: "シーン",
                sound: "音",
                flow: "流れ",
                data: "変数",
                utils: "その他",
                invalid: "不正な行",
            },
        },
    },
    diagnostics: {
        missingAsset: "この行は、プロジェクトにもう無いアセットを指している",
        unknownPuppetName: "このキャラクターのモデルにその名前はない",
    },
    find: {
        placeholder: "シーン内を検索",
        replacePlaceholder: "置換後",
        caseSensitive: "大文字小文字を区別",
        wholeWord: "単語全体に一致",
        regex: "正規表現を使う",
        // パターンがコンパイルできなかった。件数が出る場所に出す。それがこの文の答える問いだから。
        // 件数は無く、その理由がこれ。
        invalidPattern: "パターンが不正",
        noMatches: "結果なし",
        previous: "前の一致",
        next: "次の一致",
        replace: "置換",
        replaceAll: "すべて置換",
        open: "検索と置換",
    },
    commandManual: {
        open: "コマンドの手引き",
        title: "コマンドの手引き",
        searchPlaceholder: "コマンドを検索",
        aliases: "別の綴り",
        empty: "一致するコマンドがない",
    },
    manual: {
        title: "コマンド",
        searchPlaceholder: "コマンドを検索",
        empty: "一致するコマンドがない",
        pick: "コマンドを選ぶと、それが何をするかが出る",
        back: "すべてのコマンド",
        insert: "シーンに挿入",
        aliases: "この綴りでも書ける",
        parameters: "パラメータ",
        noParameters: "引数を取らない",
        examples: "例",
        required: "必須",
        optional: "任意",
        greedy: "行の残り全部を取る",
        appliesTo: "この分類にも入る",
        star: "お気に入りに入れる",
        unstar: "お気に入りから外す",
        type: {
            image: "画像アセット",
            audio: "音声アセット",
            video: "動画アセット",
            character: "キャラクター",
            characterOrName: "キャラクター、または任意の名前",
            characterForm: "そのキャラクターの表情のいずれか",
            puppet: {
                motion: "そのランタイムが知っているモーション。空にすると止める",
                expression: "そのランタイムが知っている表情。空にすると消す",
                skin: "そのランタイムが知っているスキン。空にすると既定に戻す",
                param: "そのモデルの数値パラメータを id で指定",
            },
            scene: "シーン",
            audioTrack: "オーディオトラック",
            label: "このシーンの中のラベル",
            appTag: "ビルドバリアント",
            variable: "変数",
            content: "新しい中身。対象に応じた型で書く",
            color: "色",
            literal: "任意の値",
            constant: "定数の値",
            text: "テキスト",
            expression: "式",
            expressionBoolean: "式。真か偽になるもの",
            number: "数値",
            integer: "整数",
        },
        target: {
            character: "キャラクター",
            image: "画像",
            text: "テキスト",
            layer: "レイヤー",
            video: "動画",
            audio: "音",
            vfx: "環境演出",
        },
    },
    position: {
        label: "位置",
        left: "左",
        center: "中央",
        right: "右",
    },
    rows: {
        placeholderDialogue: "台詞…",
        // 話者の言葉を待っている行の先は 2 通り。言葉を続けるか、その人に何かをさせるか。
        // だから両方を促し文に入れる。動詞は段落のどこにいるかで変わる。始まりの行は「書き始める」、
        // 続きの行は「書き続ける」。
        placeholderDialogueStart: "{name} として書き始める。{trigger} でキャラクターのアクションを挿入",
        placeholderDialogueContinue: "{name} として書き続ける。{trigger} でキャラクターのアクションを挿入",
        placeholderNarration: "地の文…",
        placeholderChoicePrompt: "選択の問いかけ…",
        placeholderChoiceText: "選択肢の文…",
        placeholderNote: "メモ…",
        placeholderText: "テキスト…",
        dragRow: "行をドラッグ",
        // 選択中の行のつまみは選択全体を運ぶ。引く前にそう言う。件数だけが、カーソルの下の行より
        // 多くが動こうとしている唯一の予告になる。
        dragRows: {
            other: "{count} 行をドラッグ",
        },
        // 行のボタン 1 つにつき 2 つの文字列。違いは要となる。`insert`／`delete` が読み上げ名で、
        // `insertTitle`／`deleteTitle` がツールチップ。後者はキー割り当てを足す。同じ文にするのは、
        // 読み上げにもポインタにも同じ 1 文がふさわしいから。括弧の形をカタログに置いてあるのは、
        // 日本語と中国語が全角の括弧を使うため。
        insert: "この行の後ろに空行を挿入",
        delete: "この行を削除",
        insertTitle: "この行の後ろに空行を挿入（{keys}）",
        deleteTitle: "この行を削除（{keys}）",
        playFromRow: "この行から再生",
        playBranch: "この枝を再生",
        insertPlaceholder: "地の文を書く。{trigger} でアクション、# でキャラクター…",
        insertPlaceholderCharacter: "{name} のアクションを選ぶ…",
        noCategoryActionFound: "{category} のアクションが見つからない",
        actionTypes: "アクションの種類",
        noCharacterFound: "キャラクターが見つからない",
        noCandidates: "一致するものがない",
        setBackground: "背景を決める",
        transform: "変形",
        invalidHint: "確定できない",
        // 行に出るのは短いほう。文になっているのはツールチップのほう。
        cutPoint: "他のビルドには無い",
        cutPointTitle: "{name} のビルドはこの行で終わる。他のどのビルドにもこの行は入らない",
        cutPointInactive: "バリアントなし",
        cutPointInactiveTitle: "この行が終わらせていたバリアントは削除されたので、何も終わらせていない",
        tempSpeaker: "名前だけ",
        createCharacter: "キャラクター「{name}」を作成",
        voiceOutdated: "ボイスが古い。ボイスの表を開く",
        voiceManage: "ボイスの表を開く",
        voicePlay: "ボイスのテイクを再生",
        // 「停止」だけでは、行の中のアイコンボタンの読み上げ名として何を止めるか分からなかった。
        voiceStop: "ボイスのテイクを停止",
    },
    sceneEditor: {
        defaultSceneName: "無題のシーン",
        untitledScene: "無題のシーン",
        changeBackgroundTitle: "既定の背景を変える",
        selectBackgroundTitle: "既定の背景を選ぶ",
        change: "変更",
        select: "選択",
        sceneName: "シーン名",
        noDescription: "説明なし",
        defaultBackground: "既定の背景",
        clearBackground: "背景を外す",
        sceneMusic: "シーンの音楽",
        clearSceneMusic: "シーンの音楽を外す",
        selectSceneMusic: "シーンの音楽を選択",
        sceneMusicVolume: "音量",
        sceneMusicLoop: "ループ",
        sceneMusicFade: "フェードイン（秒）",
        sceneMusicLoopRegion: "{from} 秒から {to} 秒をループ",
        // イントロからループへ。頭は 1 回だけ鳴り、その後ろが繰り返す。印は 3 つで、表示は 1 行のまま。
        sceneMusicIntroLoop: "{from} 秒から再生し、{loop} 秒から {to} 秒をループ",
        sceneMusicFromIn: "{from} 秒から始める",
        sceneMusicWholeClip: "クリップ全体",
        backgroundResolveError: "画像アセットを解決できなかった：{error}",
        selectDefaultBackground: "既定の背景を選択",
        tabInvalid: "ストーリーのシーンエディタのタブが不正",
        loadingScene: "ストーリーのシーンを読み込んでいる…",
        notFound: "ストーリーまたはシーンが見つからない",
        addRow: "クリックするか打ち始めると行が増える…",
        emptyHint: "このシーンは空。新しい行で {trigger} を打つとコマンドを選べる。地の文を書いてもよい",
        emptyExampleBg: "背景を出す",
        emptyExampleShow: "誰かを舞台に出す",
        emptyExampleSay: "台詞を書く",
        emptyOpenManual: "コマンドの手引きを開く",
        /** 行はあるが、絞り込みがすべて隠している。空のシーンとは別のこと。 */
        filteredEmpty: "絞り込みに一致する行がない",
        filteredEmptyClear: "すべて表示",
        snapshotsPanel: "シーンのスナップショット",
    },
    preview: {
        label: "プレビュー",
        openPreview: "実況プレビューを開く",
        closePreview: "実況プレビューを閉じる",
        title: "実況プレビュー",
        dock: "サイドバーに収める",
        pip: "ピクチャインピクチャ",
        selectRow: "舞台の状態を見るには、ストーリーの行を選ぶ",
        failed: "プレビューに失敗",
        playFromHere: "ここから再生",
        restart: "最初から",
        stop: "再生を停止",
        mute: "消音",
        unmute: "消音を解除",
        playing: "再生中",
        ended: "シーンの終わりに達した",
        endedAtJump: "シーンの飛び先で止まった",
        /**
         * 舞台のスナップショットをたどる処理が、近似せざるをえないときに出す警告。
         * プレビューの下にそのまま出るので、ログの行ではなく作者向けの文として書く。
         */
        diagnostics: {
            targetNotFound: "プレビューの対象ブロックが見つからない。代わりにシーンの先頭を表示している",
            targetUnreachable: "プレビューの対象にシーンのルートから到達できない。代わりにシーンの末尾を表示している",
            repeatedGroupOnce: "プレビューは繰り返しの群を 1 回だけ適用する",
            sceneJumpIgnored: "プレビューはシーンの飛び先を無視する",
            choiceNotTaken: "プレビューは、この前の選択でどの枝も通らなかったものとして扱う",
            conditionUnresolved: "条件 `{expression}` を解決できなかった。プレビューでは偽として扱う",
            blueprintConditionFalse: "プレビューではブループリントの条件を偽として扱う",
            persistentConditionDefaults: "プレビューでは永続変数の条件を既定値で判定する",
            videoSkipped: "動画はプレビューしない",
            ambienceSkipped: "環境演出はプレビューしない",
            storyActionSkipped: "ストーリーアクションブループリントの効果はプレビューでは再現しない",
            displayableNotFound: "表示要素の対象が見つからない：{target}",
            displayableUnnamed: "（空）",
            persistentAssignmentSkipped: "プレビューでは永続変数への代入を行わない",
            assignmentUnresolved: "式 `{expression}` を解決できなかった。プレビューではこの代入を飛ばした",
            blueprintCallEmpty: "ブループリント `{name}()` はプレビューでは動かない。空として読む",
            persistentReadEmpty: "プレビューでは永続変数は空として読む",
            sceneVisitUntracked: "プレビューはシーンの訪問を記録しない。`visited({name})` は偽として読む",
            choicePickUntracked: "プレビューは選択の結果を記録しない。`picked({name})` は偽として読む",
            presetNotFoldable: "{preset} の変形は、まだキャラクターの表示に畳み込めない",
            animationNotFound: "ストーリーのアニメーションが見つからない：{animationId}",
            animationIdMissing: "アニメーションの変形に animationId がない",
        },
    },
    blueprintCard: {
        openAria: "ストーリーアクションブループリントを開く",
        createAria: "ストーリーアクションブループリントを作成",
    },
    condition: {
        title: "条件",
        kindGraph: "グラフ",
        kindExpression: "式",
        expressionPlaceholder: "gold >= 100 && !met",
        expressionVariables: "スコープ内：{names}",
        opIsOn: "がオン",
        opIsOff: "がオフ",
        opEquals: "が等しい",
        opNotEquals: "が等しくない",
        opExists: "が設定されている",
        openGraphAria: "条件のグラフを開く",
        createGraphAria: "条件のグラフを作成",
        valueTrue: "true",
        valueFalse: "false",
        valuePlaceholder: "値",
        clear: "条件を消す",
        summarySet: "条件を決める…",
        summaryGraph: "グラフの条件",
        summaryExpression: "式",
        fallbackVariable: "変数",
        fallbackPersistent: "永続",
    },
    container: {
        addOption: "選択肢を追加",
        addAction: "アクションを追加",
        addOptionInside: "中に選択肢を追加",
        addActionInside: "中にアクションを追加",
        elseIf: "そうでなくもし",
        elseBranch: "それ以外",
    },
    repeat: {
        times: "回",
        // 見出しは「〜になるまで繰り返す」と読ませるので、これはラベルではなく助詞にあたる。
        until: "になるまで",
    },
    bulkDelete: {
        confirm: "選択中の {count} 行を削除するか",
        detail: "選んだ台本の行と、その子の行を取り除く",
    },
    actionCategory: {
        all: "すべて",
        character: "キャラクター",
        stage: "舞台",
        image: "画像",
        text: "テキスト",
        layer: "レイヤー",
        video: "動画",
        vfx: "環境演出",
        camera: "カメラ",
        scene: "シーン",
        sound: "音",
        data: "データ",
        flow: "流れ",
        utils: "道具",
    },
    pluginActionFallbackDetail: "プラグインのストーリーアクション",
    /**
     * コマンドのメニューに出す名前。コマンドのスペック id をキーにする
     * （`story.command.<id>.label`）。ここに書いた語は、作者が実際に打つ語にもなる。
     * 空白を含まない 1 語にすること。
     */
    command: {
        background: { label: "背景", detail: "シーンの背景画像か背景色を決める" },
        jump: { label: "ジャンプ", detail: "別のシーンへ移る。いまのシーンは降ろされる。/goto とは違う" },
        wait: { label: "待機", detail: "指定した秒数、またはクリックまで待つ" },
        nvl: { label: "NVL", detail: "積み上げ式のダイアログパネルを切り替える" },
        show: { label: "表示", detail: "キャラクターや舞台のオブジェクトを出す" },
        hide: { label: "非表示", detail: "キャラクターや舞台のオブジェクトを隠す" },
        move: { label: "移動", detail: "キャラクターを指定の位置へ動かす" },
        face: { label: "表情", detail: "キャラクターの表情を変える" },
        motion: { label: "モーション", detail: "ランタイムが描くキャラクターに再生させるモーションを決める" },
        param: { label: "パラメータ", detail: "ランタイムが描くキャラクターのモデルの数値パラメータを 1 つ決める" },
        skin: { label: "スキン", detail: "ランタイムが描くキャラクターが着るスキンを決める" },
        rename: { label: "改名", detail: "キャラクターが話すときの表示名を変える" },
        say: { label: "台詞", detail: "台詞を 1 行" },
        image: { label: "画像", detail: "舞台に画像を置く" },
        text: { label: "テキスト", detail: "舞台にテキストを置く" },
        video: { label: "動画", detail: "舞台に動画を置く" },
        vfx: { label: "環境演出", detail: "全画面でループする重ね描き。花びら、雨、埃、光" },
        layer: { label: "レイヤー", detail: "描画のレイヤーを作る" },
        swap: { label: "差し替え", detail: "オブジェクトの画像やテキストを入れ替える" },
        play: { label: "再生", detail: "動画を再生する" },
        font: { label: "書式", detail: "テキストの大きさや色を変える" },
        bgm: { label: "BGM", detail: "背景音楽を決める" },
        sound: { label: "効果音", detail: "効果音を鳴らす" },
        volume: { label: "音量", detail: "音量を決める。既定は BGM" },
        rate: { label: "速度", detail: "再生の速さを決める。既定は BGM" },
        stop: { label: "停止", detail: "音か動画を止める。既定は BGM" },
        pause: { label: "一時停止", detail: "音か動画を一時停止する。既定は BGM" },
        resume: { label: "再開", detail: "音か動画を再開する。既定は BGM" },
        mute: { label: "消音", detail: "音を消す。既定は BGM" },
        unmute: { label: "消音解除", detail: "消音をやめる。既定は BGM" },
        seek: { label: "シーク", detail: "動画を指定の時間へ飛ばす" },
        set: { label: "代入", detail: "変数に値を入れる" },
        inc: { label: "増加", detail: "数値の変数に足す" },
        dec: { label: "減少", detail: "数値の変数から引く" },
        toggle: { label: "反転", detail: "真偽の変数をひっくり返す" },
        reset: { label: "リセット", detail: "変数を初期値に戻す" },
        declareLocal: { label: "シーン変数", detail: "このシーンだけで有効な変数を宣言する" },
        if: { label: "条件", detail: "条件で分岐する" },
        menu: { label: "メニュー", detail: "プレイヤーに選ばせる" },
        repeat: { label: "繰り返し", detail: "中のアクションを決めた回数だけ実行する。条件で回すなら /until を使う" },
        // 詳細だけが、語そのものでは言えない 1 点を言う。`until` は *止まる* ときを言うので、
        // 群は条件が偽の間だけ動く。
        until: { label: "まで繰り返し", detail: "条件が成り立つまで、中のアクションを繰り返す。条件は毎回、実行の前に判定される" },
        break: { label: "中断", detail: "この行が入っている繰り返しの群から抜ける" },
        parallel: { label: "並行", detail: "中のアクションを同時に実行する" },
        race: { label: "先着", detail: "すべて実行し、最初に終わったところで先へ進む" },
        sequence: { label: "順次", detail: "中のアクションを順に実行する" },
        // 2 つの詳細が互いを名指しする。違いは /jump がシーンを降ろし、/goto が降ろさないことだけで、
        // 語だけからそれを当てられる作者はいない。
        label: { label: "ラベル", detail: "/goto の行き先として、このシーンの中に目印を置く" },
        goto: { label: "ラベルへ", detail: "再生位置をこのシーンのラベルへ移す。/jump と違い、シーンは動き続ける" },
        // 切る行為ではなく、できあがる行の名前を付ける。「カット」だけでは編集の切り取りに読める。
        // 名前が背負えない半分、すなわちこの行が 1 つのビルドだけのものだという事実は詳細に置く。
        cut: { label: "カットポイント", detail: "あるビルドバリアントのストーリーをこの行で終わらせる。他のビルドにこの行は入らない" },
        blueprint: { label: "ブループリント", detail: "ストーリーアクションブループリントを実行する" },
        blink: { label: "フラッシュ", detail: "画面が瞬く演出" },
        vignette: { label: "ビネット", detail: "画面の四隅を暗くする演出" },
        // 「シーンをまたいで残る」は詳細の行に置く。どのコマンドにも詳細はあり、スラッシュメニューと
        // コマンドの手引きで、作者がカメラについて最初に読む場所がそこだから。
        camera: { label: "カメラ", detail: "ステージカメラをパン、ズーム、回転、または暗くする。姿勢はシーンをまたいで残る" },
        fx: { label: "エフェクト", detail: "オブジェクトにエフェクトを掛ける" },
        transform: { label: "変形", detail: "オブジェクトを移動、拡大縮小、回転する" },
        note: { label: "メモ", detail: "Studio にだけ見えるメモ" },
    },
    containerHeader: {
        condition: "条件",
        if: "もし",
        elseIf: "そうでなくもし",
        else: "それ以外",
        repeat: "繰り返し",
        repeatUntil: "繰り返す。条件は",
        parallel: "同時に実行",
        race: "先に終わったほう",
        sequence: "順に実行",
        nvl: "NVL",
        menu: "メニュー",
        option: "選択肢",
    },
    badge: {
        declare: { scene: "ローカル", saved: "セーブ", persistent: "グローバル" },
        narration: "地の文",
        dialogue: "台詞",
        choice: "選択",
        choiceOption: "選択肢",
        background: "背景",
        character: "キャラクター",
        audio: "音声",
        variable: "変数",
        wait: "待機",
        image: "画像",
        transform: "変形",
        displayable: "表示要素",
        text: "テキスト",
        layer: "レイヤー",
        video: "動画",
        vfx: "環境演出",
        nvl: "NVL",
        blueprint: "ブループリント",
        effect: "エフェクト",
        camera: "カメラ",
        control: "制御",
        label: "ラベル",
        goto: "ラベルへ",
        break: "中断",
        cut: "カットポイント",
        jump: "ジャンプ",
        note: "メモ",
        invalid: "不正",
    },
    emptyPlaceholder: {
        narration: "ダブルクリックで地の文を入力",
        option: "ダブルクリックで選択肢の文を入力",
        choice: "ダブルクリックで選択の問いかけを入力",
        note: "ダブルクリックでメモを入力",
        text: "ダブルクリックでテキストを入力",
    },
    characterName: {
        unassigned: "キャラクター未指定",
        unknown: "不明なキャラクター",
    },
    // describeBlock() が組み立てる 1 行の要約。{operation}／{effect}／{branch}／{language} は
    // 訳さない列挙のトークン、{name}／{scene}／{value}／{ms} は作者のデータ。
    describe: {
        narration: "地の文",
        dialogue: "台詞",
        choice: "選択",
        option: "選択肢",
        setBackground: "背景を {value} にする",
        missingAsset: "アセットが見つからない",
        unassigned: "未指定",
        characterFallback: "キャラクター",
        charOp: {
            enter: "登場",
            move: "移動",
            exit: "退場",
            expression: "表情",
            setName: "改名",
            setMotion: "モーション",
            setSkin: "スキン",
            setParams: "パラメータ",
        },
        waitDuration: "{seconds} 秒待つ",
        waitClick: "クリックを待つ",
        unnamed: "名前なし",
        // 状態を書いていないランタイムの行は、未入力ではなく「消す」という指示。
        puppetNone: "なし",
        targetFallback: "対象",
        image: "画像 {name} を{operation}",
        text: "テキスト {name} を{operation}",
        layer: "レイヤー {name} を{operation}",
        video: "動画 {name} を{operation}",
        vfx: "環境演出 {name} を{operation}",
        nvl: "NVL ブロック",
        blueprint: "ブループリント",
        effect: "{effect} の画面演出",
        cameraOp: {
            pan: "パン",
            zoom: "ズーム",
            rotate: "回転",
            darken: "ステージを暗く",
            motion: "モーション",
            reset: "カメラをリセット",
        },
        condition: "条件",
        branch: "{branch} の枝",
        label: "ラベル {name}",
        goto: "{name} へ移動",
        break: "繰り返しから抜ける",
        cut: "{name} はここで終わる",
        // 名指しできるバリアントが無い。行が持つ id に応えるものが無いか、読み手にバリアントの一覧が
        // 無いか。どちらでも真であることだけを言う。削除されたと名指しするのは、一覧を持つ行の印のほう。
        cutUnknown: "カットポイント",
        jump: "{scene} へジャンプ",
        note: "メモ",
        invalid: "不正なコマンド",
        sceneUnassigned: "未指定",
        sceneUnknown: "不明なシーン",
        variableFallback: "変数",
        savedVariable: "セーブ変数",
        persistent: "永続",
    },
    quickParam: {
        waitLabel: "待機",
        jumpLabel: "行き先",
    },
    lens: {
        toLens: "タイムライン表示",
        toList: "リスト表示",
    },
    rowMenu: {
        insertAbove: "上に挿入",
        insertBelow: "下に挿入",
        duplicate: "複製",
        disable: "無効にする",
        enable: "有効にする",
        playFromHere: "ここから再生",
        openInspector: "インスペクタを開く",
        delete: "削除",
    },
    // これらの削除が履歴に残す名前（「シーン 駅にて の削除を元に戻す」）。
    history: {
        deleteScene: "シーン {name} の削除",
        deleteChapter: "チャプター {name} の削除",
        deleteStory: "ストーリー {name} の削除",
        deleteAnimation: "モーション {name} の削除",
    },
    keybindings: {
        find: "検索と置換",
        deleteRows: "選択中のストーリーの行を削除",
        deleteRowsConfirm: "選択中のストーリーの行を、複数選択の確認つきで削除",
        undo: "ストーリーのシーンの編集を元に戻す",
        redo: "ストーリーのシーンの編集をやり直す",
        editRow: "現在の行を編集する、またはそのインスペクタを開く",
        closeInspector: "プロパティの編集を閉じる",
        insertRow: "現在の行の下に新しい行を挿入",
        indent: "選択中のストーリーの行を字下げ",
        outdent: "選択中のストーリーの行の字下げを戻す",
        selectAll: "表示中のストーリーの行をすべて選択",
        duplicateRows: "選択中のストーリーの行を複製",
        moveSelectionDown: "ストーリーの行の選択を下へ",
        moveSelectionUp: "ストーリーの行の選択を上へ",
        extendSelectionDown: "ストーリーの行の選択を下へ広げる",
        extendSelectionUp: "ストーリーの行の選択を上へ広げる",
        moveRowDown: "選択中のストーリーの行を下へ移動",
        moveRowUp: "選択中のストーリーの行を上へ移動",
        selectFirst: "先頭のストーリーの行を選択",
        selectLast: "末尾のストーリーの行を選択",
        pageDown: "ストーリーの行の選択を 1 画面分下へ",
        pageUp: "ストーリーの行の選択を 1 画面分上へ",
    },
} satisfies LocaleNamespace<"story">;
