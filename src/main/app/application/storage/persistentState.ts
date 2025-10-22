import sqlite3 from "sqlite3";
import { Database } from "sqlite3";
import {
    IPersistentState,
    PersistentStateConfig,
    StoredValue
} from "@shared/types/persistentState";
import fs from "fs/promises";
import path from "path";
import { GLOBAL_STATE_DEFAULTS } from "@shared/types/state/globalState";

/**
 * SQLite-based persistent key-value storage implementation
 */
export class PersistentState implements IPersistentState {
    private db: Database | null = null;
    private config: PersistentStateConfig;
    private initialized: boolean = false;
    private initializationPromise: Promise<void>;

    constructor(config: PersistentStateConfig) {
        this.config = {
            tableName: 'key_value_store',
            ...config
        };
        this.initializationPromise = this.initialize();
    }

    /**
     * Initialize the database connection and create tables
     */
    private async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Ensure the directory exists
        const dbDir = path.dirname(this.config.dbPath);
        await fs.mkdir(dbDir, { recursive: true });

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.config.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Create table if it doesn't exist
                const createTableSQL = `
                    CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
                        key TEXT PRIMARY KEY,
                        type TEXT NOT NULL,
                        data TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `;

                this.db!.run(createTableSQL, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Create trigger to update updated_at timestamp
                    const createTriggerSQL = `
                        CREATE TRIGGER IF NOT EXISTS update_${this.config.tableName}_timestamp
                        AFTER UPDATE ON ${this.config.tableName}
                        BEGIN
                            UPDATE ${this.config.tableName} SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
                        END
                    `;

                    this.db!.run(createTriggerSQL, (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        // Set default values if provided
                        this.setDefaults().then(() => {
                            this.initialized = true;
                            resolve();
                        }).catch(reject);
                    });
                });
            });
        });
    }

    /**
     * Set default values from global state defaults
     */
    private async setDefaults(): Promise<void> {
        if (!this.db) {
            return;
        }

        // Check if this is a global state database and set defaults
        if (this.config.dbPath.includes('global') && this.config.tableName === 'key_value_store') {
            for (const [key, value] of Object.entries(GLOBAL_STATE_DEFAULTS)) {
                if (value === undefined) continue;

                const exists = await new Promise<boolean>((resolve, reject) => {
                    const q = `SELECT 1 FROM ${this.config.tableName} WHERE key = ? LIMIT 1`;
                    this.db!.get(q, [key], (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(Boolean(row));
                    });
                });

                if (!exists) {
                    const storedValue = this.createStoredValue(value);
                    await this.insertOrIgnore(key, storedValue);
                }
            }
        }
    }

    /**
     * Create a stored value with type information
     */
    private createStoredValue(value: any): StoredValue {
        let type: StoredValue['type'] = 'null';
        let data: any = null;

        if (value === null || value === undefined) {
            type = 'null';
            data = null;
        } else if (typeof value === 'string') {
            type = 'string';
            data = value;
        } else if (typeof value === 'number') {
            type = 'number';
            data = value;
        } else if (typeof value === 'boolean') {
            type = 'boolean';
            data = value;
        } else {
            type = 'object';
            data = JSON.stringify(value);
        }

        return { type, data };
    }

    /**
     * Parse a stored value back to its original type
     */
    private parseStoredValue(storedValue: StoredValue): any {
        switch (storedValue.type) {
            case 'string':
                return storedValue.data;
            case 'number':
                return Number(storedValue.data);
            case 'boolean':
                return Boolean(storedValue.data);
            case 'object':
                return JSON.parse(storedValue.data);
            case 'null':
                return null;
            default:
                return storedValue.data;
        }
    }

    /**
     * Insert or ignore a key-value pair
     */
    private insertOrIgnore(key: string, storedValue: StoredValue): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            const query = `
                INSERT OR IGNORE INTO ${this.config.tableName} (key, type, data)
                VALUES (?, ?, ?)
            `;

            this.db!.run(query, [key, storedValue.type, storedValue.data], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Get item from storage
     */
    public async getItem<T>(key: string): Promise<T | undefined>;
    public async getItem<T>(key: string, defaultValue: T): Promise<T>;
    public async getItem<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        await this.ready();

        if (!this.isValidKey(key)) {
            throw new Error(`Invalid key: ${key}. Keys must contain only English letters, numbers, and dots.`);
        }

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            const query = `SELECT type, data FROM ${this.config.tableName} WHERE key = ?`;
            this.db!.get(query, [key], (err, row: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (row) {
                    try {
                        const storedValue: StoredValue = {
                            type: row.type,
                            data: row.data
                        };
                        const parsed = this.parseStoredValue(storedValue);
                        resolve(parsed as T);
                    } catch (error) {
                        reject(new Error(`Failed to parse stored value for key ${key}: ${error}`));
                    }
                } else {
                    resolve(defaultValue as T);
                }
            });
        });
    }

    /**
     * Set item in storage
     */
    public async setItem(key: string, data: any): Promise<void> {
        await this.ready();

        if (!this.isValidKey(key)) {
            throw new Error(`Invalid key: ${key}. Keys must contain only English letters, numbers, and dots.`);
        }

        const storedValue = this.createStoredValue(data);

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            // Use SQLite UPSERT to preserve created_at and correctly update updated_at
            const query = `
                INSERT INTO ${this.config.tableName} (key, type, data)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    type = excluded.type,
                    data = excluded.data,
                    updated_at = CURRENT_TIMESTAMP
            `;

            this.db!.run(query, [key, storedValue.type, storedValue.data], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Remove item from storage
     */
    public async removeItem(key: string): Promise<void> {
        await this.ready();

        if (!this.isValidKey(key)) {
            throw new Error(`Invalid key: ${key}. Keys must contain only English letters, numbers, and dots.`);
        }

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            const query = `DELETE FROM ${this.config.tableName} WHERE key = ?`;
            this.db!.run(query, [key], (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    /**
     * Get all keys in storage
     */
    public async keys(): Promise<string[]> {
        await this.ready();

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            const query = `SELECT key FROM ${this.config.tableName} ORDER BY key`;
            this.db!.all(query, [], (err, rows: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows.map(row => row.key));
            });
        });
    }

    /**
     * Clear all data in storage
     */
    public async clear(): Promise<void> {
        await this.ready();

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error("Database not initialized"));
                return;
            }

            const query = `DELETE FROM ${this.config.tableName}`;
            this.db!.run(query, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    /**
     * Check if database is ready
     */
    public isReady(): boolean {
        return this.initialized;
    }

    /**
     * Wait for database to be ready
     */
    public async ready(): Promise<void> {
        await this.initializationPromise;
    }

    /**
     * Close the database connection
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initialized = false;
        }

        // Prevent further usage without re-instantiation
        this.initializationPromise = Promise.reject(new Error("PersistentState instance has been closed."));
    }

    /**
     * Get the configuration of this persistent state
     */
    public getConfig(): PersistentStateConfig {
        return { ...this.config };
    }

    /**
     * Validate that a key contains only valid characters (English letters, numbers, and dots)
     */
    private isValidKey(key: string): boolean {
        // Keys should be strings with only English letters, numbers, and dots
        // Should not start or end with dots, and should not have consecutive dots
        const keyPattern = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
        return keyPattern.test(key) && key.length > 0;
    }

}
