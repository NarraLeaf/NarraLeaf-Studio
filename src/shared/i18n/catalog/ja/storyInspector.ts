import type { LocaleNamespace } from "../types";

/** `storyInspector` 日本語。ストーリーのシーンエディタで、アクションの種類ごとに出るインスペクタ。 */
export const storyInspector = {
    // この行の翻訳／ボイスの単位 id を隠している開閉部。id 自体は uuid なので、
    // ラベルはそれが何であるかではなく、何のためのものかを言う。
    textId: "ローカライズのキー",
    advanced: "詳細",
    advancedParams: "詳細なパラメータ",
    noVariablesDeclared: "宣言された変数がない",
    unassigned: "未割り当て",

    section: {
        timing: "タイミング",
        conditions: "条件",
        appearance: "見た目",
        blueprint: "ブループリント",
        effect: "エフェクト",
        transform: "変形",
        transition: "トランジション",
        voice: "ボイス",
        // どの項目にも言えないカメラの及ぶ範囲を見出しで言う。姿勢はシーンより長く残る。
        camera: "カメラ · ストーリー全体",
        // どの項目にも言えない範囲を言う。オーバーレイはレイヤーの中ではなく舞台全体の上に乗る。
        vfx: "アンビエンス · 全画面のオーバーレイ",
    },

    voice: {
        voiced: "収録済み",
        none: "テイクなし",
        stale: "古い",
        openTable: "ボイスの表を開く",
    },

    field: {
        operation: "操作",
        value: "値",
        valueJson: "値（JSON）",
        scope: "スコープ",
        variable: "変数",
        mode: "モード",
        duration: "長さ（秒）",
        hold: "保持（秒）",
        easing: "イージング",
        color: "色",
        opacity: "不透明度",
        center: "中心",
        fromRadius: "開始の半径",
        toRadius: "終了の半径",
        direction: "方向",
        reverse: "逆",
        feather: "ぼかし %",
        orientation: "向き",
        slats: "羽根の数",
        axis: "軸",
        blades: "ブレードの数",
        fromAngle: "開始の角度 °",
        rows: "行",
        cols: "列",
        stagger: "ずらし",
        shape: "形",
        pattern: "パターン",
        kind: "種類",
        effect: "エフェクト",
        character: "キャラクター",
        layer: "レイヤー",
        muted: "消音",
    },

    motionTarget: {
        image: "画像",
        text: "テキスト",
        layer: "レイヤー",
        character: "キャラクター",
        displayable: "表示要素",
        camera: "ステージカメラ",
    },

    variableScope: {
        scene: "シーン",
        saved: "セーブ",
        persistent: "永続",
    },

    transformPreset: {
        left: "左",
        center: "中央",
        right: "右",
        fadeIn: "フェードイン",
        fadeOut: "フェードアウト",
        slideLeft: "左へスライド",
        slideRight: "右へスライド",
        slideUp: "上へスライド",
        slideDown: "下へスライド",
        zoom: "ズーム",
        scale: "拡大縮小",
        rotate: "回転",
        opacity: "不透明度",
        darken: "暗くする",
        flip: "左右反転",
        circleReveal: "円で開く",
        circleClose: "円で閉じる",
        slideReveal: "スライドで開く",
    },

    easing: {
        default: "既定",
        linear: "リニア",
        easeIn: "イーズイン",
        easeOut: "イーズアウト",
        easeInOut: "イーズインアウト",
        circIn: "サークルイン",
        circOut: "サークルアウト",
        circInOut: "サークルインアウト",
        backIn: "バックイン",
        backOut: "バックアウト",
        backInOut: "バックインアウト",
        anticipate: "予備動作",
    },

    transition: {
        dissolve: "ディゾルブ",
        blurDissolve: "ぼかしディゾルブ",
        fadeIn: "フェードイン",
        maskCircle: "円マスク",
        softIris: "ソフトアイリス",
        maskWipe: "スライドで開く",
        softWipe: "ソフトワイプ",
        blinds: "ブラインド",
        barnDoor: "観音開き",
        clock: "時計",
        fan: "扇",
        dots: "ドット",
        slide: "プッシュ",
        throughColor: "色を挟む",
        darkness: "暗さ",
        exposure: "露出",
        exposureEv: "露出量（EV）",
        exposureLift: "暗部の持ち上げ 0-1",
        startX: "開始 X",
        startY: "開始 Y",
        blurPx: "ぼかし px",
        holdPct: "保持 %",
        darknessFrom: "開始の暗さ 0-1",
        darknessTo: "終了の暗さ 0-1",
    },

    transitionHint: {
        dissolve: "前の画像から新しい画像へ重ねながら切り替える",
        blurDissolve: "ぼかしながら重ねて切り替える。回想や夢の場面向け",
        fadeIn: "開始位置をずらしたところから新しい画像をフェードインする",
        maskCircle: "輪郭のはっきりした円が画面の上で開くか閉じる",
        softIris: "同じ円を、縁をぼかして行う",
        maskWipe: "まっすぐな境目が横切り、新しい画像を現す",
        softWipe: "同じ動きを、境目をぼかして行う",
        blinds: "羽根が広がって新しい画像を現す",
        barnDoor: "柔らかい 2 つの境目が両側から中央へ閉じる",
        clock: "中心のまわりを放射状の境目が一周する",
        fan: "何枚かのブレードが中心のまわりを並んで回る",
        dots: "格子状のドットが広がり、やがてつながって埋まる",
        slide: "古い画像が出ていき、新しい画像が片側から入ってくる",
        darkness: "開始の暗さで画像を入れ替え、終了の暗さまで動かす。1 → 0 は暗転から明け、0 → 1 は暗転へ落とす",
        throughColor: "画面をいったん色で覆い、保持してから、新しい画像の上で外す。暗転や白転、アイリス、フラッシュ（保持 0）に使う",
        exposure: "画面を白飛びさせ、ハイライトから先に、暗部を最後に飛ばしてから新しい画面へ戻る。暗部の持ち上げが 0 だと黒は白くならない",
    },

    wipeDirection: {
        left: "左",
        right: "右",
        top: "上",
        bottom: "下",
    },

    blindsOrientation: {
        horizontal: "横",
        vertical: "縦",
    },

    clockDirection: {
        clockwise: "時計回り",
        counterclockwise: "反時計回り",
    },

    irisShape: {
        circle: "円",
        ellipse: "楕円",
    },

    throughColorPattern: {
        plain: "均一（フェード）",
        linear: "ぼかした境目",
        blinds: "ブラインド",
        iris: "アイリス",
    },

    imageOperation: {
        create: "作成／更新",
        setSource: "画像を差し替え",
    },

    vfxOperation: {
        pause: "止める",
        resume: "続ける",
        setRate: "速さを決める",
    },

    // CSS のキーワードではなく、そのモードが何のためのものかで名付ける。選択はクリップについての
    // 制作上の事実で、キーワードだけでは答えを知っている人の役にしか立たない。
    vfxBlend: {
        normal: "通常（アルファ付き透過 WebM）",
        screen: "スクリーン（黒地の発光）",
        multiply: "乗算（白地の影）",
        lighten: "比較（明）",
        colorDodge: "覆い焼きカラー",
        overlay: "オーバーレイ",
    },

    vfxFit: {
        cover: "カバー",
        contain: "収める",
        fill: "引き伸ばし",
    },

    vfx: {
        name: "エフェクト名",
        clip: "ループするクリップ",
        blendMode: "ブレンド",
        opacity: "不透明度（0-1）",
        fit: "合わせ方",
        zIndex: "重ね順",
        loop: "ループ",
        rate: "速さ（1 が等倍）",
        fade: "フェード（秒）",
    },

    cameraOperation: {
        zoom: "ズーム",
        pan: "パン",
        rotate: "回転",
        // 「画面」ではなく「ステージ」。これはカメラの明るさで、`/vignette` のシーン内マスクではない。
        darken: "ステージを暗くする",
        motion: "カメラのモーション",
        reset: "カメラをリセット",
    },

    // 選択ボタンのラベル。6 つが横に並ぶ短さにしてある。上の正式名はそれぞれのツールチップに残るので、
    // 「ステージを暗くする」は必要な場所で *ステージ* と言える。
    cameraOperationShort: {
        zoom: "ズーム",
        pan: "パン",
        rotate: "回転",
        darken: "暗く",
        motion: "モーション",
        reset: "リセット",
    },

    camera: {
        zoom: "ズーム（1 が基準）",
        rotation: "回転 °",
        darkness: "ステージの暗さ（0-1）",
        xalign: "X の基準（0-1）",
        yalign: "Y の基準（0-1）",
    },

    displayableOperation: {
        transform: "変形",
        mask: "マスク",
        clearMask: "マスクを外す",
        clip: "クリップパス",
        clearClip: "クリップを外す",
        filter: "フィルター",
        clearFilter: "フィルターを外す",
        backdrop: "背景処理",
        blend: "ブレンドモード",
        darken: "暗くする",
        circleReveal: "円で開く",
        circleClose: "円で閉じる",
        wipe: "スライドで開く",
    },

    displayableEffectHint: {
        mask: "画像アセットを CSS のマスクとして掛ける",
        clearMask: "いま掛かっているマスクを外す",
        clip: "CSS の clip-path を掛ける",
        clearClip: "いま掛かっている clip-path を外す",
        filter: "CSS のフィルターを掛ける。例：blur(4px) grayscale(1)",
        clearFilter: "いま掛かっているフィルターを外す",
        backdrop: "CSS の backdrop-filter で、透けて見える部分を加工する。例：blur(8px)",
        blend: "mix-blend-mode で背後のものと混ぜる",
        darken: "暗さのオーバーレイを 0〜1 で animate する。画像とキャラクターにだけ効く",
        circleReveal: "マスクを動かして円形に現す",
        circleClose: "マスクを動かして円形に閉じる",
        wipe: "clip-path を動かして方向のある境目で現す。ぼかしはない",
    },

    textOperation: {
        create: "作成／更新",
        setText: "文を差し替え",
        setFontSize: "文字サイズを決める",
        setFontColor: "文字色を決める",
    },

    layerOperation: {
        setZIndex: "重ね順を決める",
    },

    videoOperation: {
        // 「再生」はクリップが終わるまでストーリーを待たせる。「再開」は待たせない。
        play: "再生（終わるまで待つ）",
        pause: "一時停止",
        resume: "再開",
        stop: "停止",
        seek: "この位置へ",
    },

    audioOperation: {
        setBgm: "BGM を決める",
        playSound: "効果音を鳴らす",
        stopSound: "効果音を止める",
        pauseSound: "効果音を一時停止",
        resumeSound: "効果音を再開",
        setVolume: "音量を決める",
        setRate: "再生速度を決める",
        muteSound: "消音を切り替え",
        seekSound: "この位置へ",
    },

    screenEffectOption: {
        blink: "まばたき",
        vignette: "ビネット",
    },

    waitMode: {
        duration: "時間",
        click: "クリック",
    },

    branch: {
        if: "もし",
        elseIf: "そうでなくもし",
        else: "それ以外",
    },

    narration: {
        editHint: "行をダブルクリックすると地の文を編集できる",
    },

    dialogue: {
        pauseAfter: "この行のあとで止める",
        pauseSeconds: "停止（秒、任意）",
    },

    choice: {
        prompt: "問いかけ",
    },

    choiceOption: {
        optionText: "選択肢の文",
        hiddenWhen: "隠す条件",
        disabledWhen: "選べなくする条件",
        hint: "条件を空にすると、この選択肢は常に表示され、常に選べる",
    },

    jump: {
        targetScene: "行き先のシーン",
    },

    note: {
        label: "メモ",
    },

    blueprint: {
        storyActionTitle: "ストーリーアクション",
    },

    audio: {
        track: "トラック",
        // 指定の無い参照が落ちるトラックの名前。空の選択肢が空白にならないようにする。
        trackDefault: "既定（{name}）",
        soundName: "効果音の名前",
        bgmAsset: "BGM のアセット",
        soundAsset: "効果音のアセット",
        fade: "フェード（秒）",
        seekTime: "この位置へ（秒）",
        volume: "音量",
        rate: "再生速度",
        loop: "ループ",
    },

    image: {
        imageName: "画像の名前",
        imageAsset: "画像アセット",
        autoFit: "自動で合わせる",
    },

    text: {
        textName: "テキストの名前",
        fontSize: "文字サイズ",
        fontColor: "文字色",
        text: "テキスト",
    },

    layer: {
        layerName: "レイヤーの名前",
        zIndex: "重ね順",
    },

    video: {
        videoName: "動画の名前",
        videoAsset: "動画アセット",
        seekTime: "この位置へ",
    },

    nvl: {
        hint: "子の行は NVL モードで動く。下の変形は、NVL のレイヤーが入ってくるときの動き",
        motionLabel: "NVL の登場アニメーション",
    },

    character: {
        // 後の行がこのキャラクターを指すときの呼び名。`/move Nattou`、`/hide Nattou` のように使う。
        // 作者がそれで何をするかで名付けた。「ステージ名」はエンジン側がオブジェクトを呼ぶ語。
        objectName: "この名前で指す",
        // 書き込む項目ではなく、プレイヤーが読むもので名付ける。この行から先の話者の表示名で、
        // 「？？？」が名前に変わるのはこれ。
        displayName: "話者としての表示名",
        chooseHint: "見た目を選ぶには、まずキャラクターを選ぶ",
        overrideImage: "画像を個別指定",
        // 自前のランタイムが描くキャラクター。名前はモデルから来るので、これらの項目は
        // モデルが自分について報告した内容で埋まる。空にすることは未入力ではなく「消す」という指示で、
        // だから各項目が、消したときにどうなるかを名前で言う。
        puppetMotion: "モーション",
        puppetExpression: "表情",
        puppetSkin: "スキン",
        puppetNone: "なし",
        puppetSkinDefault: "モデルの既定",
        puppetParams: "パラメータ",
        puppetParamId: "パラメータ",
        puppetParamValue: "値",
        puppetParamAdd: "パラメータを追加",
        puppetParamRemove: "パラメータを取り除く",
        puppetNoParams: "この行はまだパラメータを設定していない",
        notPuppetHint: "このキャラクターは Studio が描くので、設定できるランタイムの状態はない",
    },

    asset: {
        missing: "アセットが見つからない",
        none: "アセットなし",
        clear: "アセットを外す",
        selectTitle: "{label} を選択",
    },

    displayableEffect: {
        maskImage: "マスク画像",
        clipPath: "クリップパス",
        cssFilter: "CSS フィルター",
        backdropFilter: "CSS backdrop-filter",
        blendMode: "ブレンドモード",
        darkness: "暗さ 0-1",
    },

    transform: {
        presetMode: "プリセット",
        motionMode: "モーション",
        preset: "プリセット",
        zoom: "ズーム",
        xOffset: "X のずれ",
        yOffset: "Y のずれ",
        params: "パラメータ",
    },

    background: {
        image: "画像",
        color: "色",
        missing: "画像が見つからない",
        none: "画像なし",
        change: "変更",
        select: "選択",
        clearImage: "画像を外す",
        assetError: "画像アセットを解決できなかった：{error}",
        selectImageTitle: "背景画像を選択",
    },

    control: {
        labelName: "ラベル名",
        gotoTarget: "このラベルへ",
        noLabels: "このシーンにラベルがない",
        conditionContainer: "条件の入れ物。条件の枝を子として足す",
        control: "制御",
        sequence: "順に実行",
        parallel: "すべて並列",
        race: "どれか 1 つ",
        repeat: "繰り返し",
        mode: {
            do: "実行",
            doAsync: "非同期で実行",
            all: "すべて",
            allAsync: "すべて非同期",
            any: "いずれか",
        },
        times: "回数",
        loopKind: "ループ",
        loopKindTimes: "回数を決める",
        loopKindUntil: "条件が成り立つまで",
        until: "止める条件",
        // 語そのものが言わない 2 点を書き出す。これは *止まる* 条件で、しかも本体より先に
        // 判定されるので、すでに成り立っていればこの群は一度も動かない。
        untilHint: "これが偽の間くり返し、真になったところで止まる。条件は毎回、実行の前に判定される",
        breakHint: "この行を含む繰り返しの群から抜ける。繰り返しの外では何もしない",
        cutVariant: "ビルドバリアント",
        cutHint: "このビルドはこの行で終わり、これより後は何も入らない。他のビルドは変わらず、この行も入らない",
        // 行が名指しするバリアントは、もうプロジェクトにない。他の宙に浮いた参照と同じくリリースの値を
        // 読み、リリースのビルドではカットポイントは何も終わらせない。
        cutMissingVariant: "削除されたバリアント。今は {name} として読む",
        cutNoVariants: "バリアントがない",
        branch: "枝",
        elseHint: "前の枝がどれも当てはまらないとき、それ以外の枝が動く",
    },

    condition: {
        brokenExpression: "この式はもう解決できない。読んでいる変数の名前が変わったか、削除された可能性がある。式を直すまで、この枝は偽のまま",
        clear: "条件を消す",
    },

    declaration: {
        name: "名前",
        type: "型",
        default: "既定値",
        description: "説明",
    },
} satisfies LocaleNamespace<"storyInspector">;
