import type { LocaleNamespace } from "../types";

export const serverTrust = {
    window: "服务器信任",
    title: "信任该服务器？",
    issuedBy: "颁发者：{subject}",
    fingerprint: "指纹",
    // 一句话说清代价，不作弱化。「本账户」不是细节：受影响的范围到此为止。
    meaning: "信任后，该颁发机构签发的证书将被本账户接受。",
    confirm: "信任",
    cancel: "取消",
    working: "信任中…",
    error: {
        load: "无法读取该服务器的信息。",
        trust: "未能信任该颁发机构。",
    },
} satisfies LocaleNamespace<"serverTrust">;
