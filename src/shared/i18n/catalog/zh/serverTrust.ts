import type { LocaleNamespace } from "../types";

export const serverTrust = {
    window: "服务器信任",
    title: "信任该服务器？",
    issuedBy: "颁发者：{subject}",
    fingerprint: "指纹",
    // 一句话说清代价，不作弱化。「本账户」不是细节：受影响的范围到此为止。
    meaning: "持有该颁发机构密钥的任何一方，都能为任意地址签发证书，而本账户都会相信。",
    confirm: "信任",
    cancel: "取消",
    working: "信任中…",
    error: {
        load: "无法读取本次确认所涉及的服务器。",
        trust: "未能信任该颁发机构。",
    },
} satisfies LocaleNamespace<"serverTrust">;
