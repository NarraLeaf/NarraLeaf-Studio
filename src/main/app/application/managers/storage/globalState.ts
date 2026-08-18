import { UserDataNamespace } from "@shared/types/constants";
import { PersistentStateConfig } from "@shared/types/persistentState";
import {
  GLOBAL_STATE_DEFAULTS,
  GlobalStateKeys,
  GlobalStateType,
  GlobalStateValue,
  RETIRED_GLOBAL_STATE_KEYS
} from "@shared/types/state/globalState";
import path from "path";
import { PersistentState } from "../../../../../shared/utils/persistentState";
import { RecentlyOpened } from "./recentlyOpened";

export class GlobalStateManager {
  private state: PersistentState<GlobalStateType>;

  public recentlyOpened: RecentlyOpened;

  constructor(userDataDir: string) {
    const dbPath = path.join(userDataDir, UserDataNamespace.State, "global.config");
    const config: PersistentStateConfig<GlobalStateType> = {
      dbPath,
      defaults: GLOBAL_STATE_DEFAULTS as GlobalStateType
    };

    this.state = new PersistentState<GlobalStateType>(config);
    this.recentlyOpened = new RecentlyOpened(this.state);
  }

  /**
   * Get a value from global state.
   *
   * Throws an error if the key is not found and `assert` is true
   */
  public get<K extends GlobalStateKeys>(key: K, assert: boolean = false): GlobalStateValue<K> {
    return this.state.getItem<K>(key, assert);
  }

  /**
   * Set a value in global state
   */
  public set<K extends GlobalStateKeys>(key: K, value: GlobalStateValue<K>): void {
    return this.state.setItem(key, value);
  }

  /**
   * Remove a key, so the next read resolves the default instead of a stored value.
   *
   * Not the same thing as writing the default over it, which is what the renderer had to
   * settle for while there was no delete channel (see `clearAllProjectStats`): several keys
   * are deliberately absent from GLOBAL_STATE_DEFAULTS precisely so their reader can pick a
   * fallback the store cannot know - `ui.background*` clamps and whitelists, and
   * `editor.slashAtAlias` answers per device locale. For those, "reset" is only expressible
   * as absence.
   */
  public delete<K extends GlobalStateKeys>(key: K): void {
    this.state.removeItem(key);
  }

  /** Whether a value is stored under `key` - which is not the same as it having a default. */
  public has<K extends GlobalStateKeys>(key: K): boolean {
    return Object.prototype.hasOwnProperty.call(this.state.raw(), key);
  }

  /**
   * Get all keys
   */
  public getAllKeys(): string[] {
    return this.state.keys();
  }

  /**
   * Get all data
   */
  public raw(): GlobalStateType {
    return this.state.raw();
  }

  /**
   * Delete the keys that once shipped a default and were read by nothing.
   *
   * Runs once at startup, before any window exists, so there is nothing to broadcast to.
   * Returns the keys actually removed for the log line - on a profile that never had them
   * this is empty and says nothing.
   */
  public sweepRetiredKeys(): string[] {
    const removed: string[] = [];
    for (const key of RETIRED_GLOBAL_STATE_KEYS) {
      if (this.has(key)) {
        this.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }
}
