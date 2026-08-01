import fs from "fs/promises";
import { safeStorage } from "electron";
import { UserDataNamespace } from "@shared/types/constants";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { type SigningInspectResult } from "@shared/types/signing";
import { listAliases } from "../../../../../buildWorker/mobile/keystoreReader";
import { findMacSigningIdentities } from "../../build/macSigningIdentity";
import {
    certificateContainer,
    credentialKindHasCertificate,
    inspectCertificateFile,
} from "../../security/certificateInspect";
import { SigningVault, type SecretSealer } from "../../security/signingVault";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * IPC surface for the code-signing credential vault.
 *
 * No handler here returns a secret. `import` takes plain passwords up (the
 * author just typed them) and hands back the redacted credential; unsealing is
 * the main process's business alone and happens when a build needs the
 * material, not on request from a window.
 */

/** Electron's keyring, wrapped so the vault itself stays Electron-free and testable. */
const electronSealer: SecretSealer = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText: string) => safeStorage.encryptString(plainText),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
};

/**
 * The vault is machine-level, not per project, so one instance serves every
 * window. Keyed by root anyway: tests and a relocated user-data dir would
 * otherwise keep talking to the first one.
 */
let cached: { root: string; vault: SigningVault } | null = null;

function vaultFor(window: AppWindow): SigningVault {
    const root = window.app.storageManager.getNamespacePath(UserDataNamespace.Signing);
    if (!cached || cached.root !== root) {
        cached = { root, vault: new SigningVault({ root, sealer: electronSealer }) };
    }
    return cached.vault;
}

export class SigningListHandler extends IPCHandler<IPCEventType.signingList> {
    readonly name = IPCEventType.signingList;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingList]["response"]>> {
        return this.tryUse(async () => ({ credentials: await vaultFor(window).list() }));
    }
}

export class SigningImportHandler extends IPCHandler<IPCEventType.signingImport> {
    readonly name = IPCEventType.signingImport;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { input }: IPCEvents[IPCEventType.signingImport]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingImport]["response"]>> {
        // `input` carries plain passwords: it must not be logged, and the error
        // path below reports only the vault's own message, never the payload.
        return this.tryUse(async () => ({ credential: await vaultFor(window).import(input) }));
    }
}

export class SigningRemoveHandler extends IPCHandler<IPCEventType.signingRemove> {
    readonly name = IPCEventType.signingRemove;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { id }: IPCEvents[IPCEventType.signingRemove]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingRemove]["response"]>> {
        return this.tryUse(async () => ({ removed: await vaultFor(window).remove(id) }));
    }
}

export class SigningInspectHandler extends IPCHandler<IPCEventType.signingInspect> {
    readonly name = IPCEventType.signingInspect;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { id }: IPCEvents[IPCEventType.signingInspect]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingInspect]["response"]>> {
        return this.tryUse(async () => {
            const vault = vaultFor(window);
            const credential = await vault.get(id);
            if (!credential) {
                return { available: false, reason: "unreadable" } satisfies SigningInspectResult;
            }
            if (!credentialKindHasCertificate(credential.kind)) {
                // Nothing to read: the certificate lives in the Windows store,
                // in Azure, in the login keychain, or the kind has none at all.
                return { available: false, reason: "no-certificate" } satisfies SigningInspectResult;
            }
            // The one place a window's question reaches an unsealed password.
            // The passwords open the keystore and are dropped when this call
            // returns; what goes back over IPC is `SigningInspectResult`, which
            // by its type can only carry certificate facts.
            const material = await vault.resolveMaterial(id);
            const target = material ? certificateContainer(material) : null;
            if (!target) {
                return { available: false, reason: "unreadable" } satisfies SigningInspectResult;
            }
            return inspectCertificateFile(target.file, target.secrets);
        });
    }
}

/**
 * Ask a keystore which signing keys it holds, so the import form can offer them
 * instead of making the author type an alias blind.
 *
 * Takes a path the author just picked and the password they just typed - the
 * same one-way traffic as `import`, and for the same reason. Neither is kept,
 * and only the alias names come back.
 */
export class SigningKeystoreAliasesHandler extends IPCHandler<IPCEventType.signingKeystoreAliases> {
    readonly name = IPCEventType.signingKeystoreAliases;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        { file, storePassword }: IPCEvents[IPCEventType.signingKeystoreAliases]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingKeystoreAliases]["response"]>> {
        // KeystoreError messages are written for the author who picked the file
        // ("wrong password", "convert it with keytool"), so `tryUse` passing the
        // message through is the point, not a leak.
        return this.tryUse(async () => ({ aliases: listAliases(await fs.readFile(file), storePassword) }));
    }
}

/**
 * The code-signing identities this Mac holds, so the import form can offer them
 * rather than making the author transcribe a certificate name from Keychain
 * Access - which is exactly the kind of string a typo makes unfindable.
 *
 * Reads nothing but the certificate list; no key material is touched and nothing
 * secret comes back.
 */
export class SigningMacIdentitiesHandler extends IPCHandler<IPCEventType.signingMacIdentities> {
    readonly name = IPCEventType.signingMacIdentities;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
    ): Promise<RequestStatus<IPCEvents[IPCEventType.signingMacIdentities]["response"]>> {
        return this.tryUse(async () => ({ identities: await findMacSigningIdentities() }));
    }
}

