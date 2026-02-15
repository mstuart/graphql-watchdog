import type { CacheBackend } from './backend.js';

export interface RedisBackendConfig {
  url?: string;           // redis://localhost:6379
  host?: string;          // default 'localhost'
  port?: number;          // default 6379
  password?: string;
  db?: number;            // default 0
  keyPrefix?: string;     // default 'gql-watchdog:'
}

export class RedisCacheBackend implements CacheBackend {
  private client: any = null;
  private config: Required<Pick<RedisBackendConfig, 'keyPrefix'>> & RedisBackendConfig;

  constructor(config?: RedisBackendConfig) {
    this.config = {
      keyPrefix: 'gql-watchdog:',
      ...config,
    };
  }

  async connect(): Promise<void> {
    if (this.client) return;

    let Redis: any;
    try {
      // Use variable to prevent TypeScript from resolving the module at build time
      const moduleName = 'ioredis';
      const ioredis = await (Function('m', 'return import(m)') as (m: string) => Promise<any>)(moduleName);
      Redis = ioredis.default ?? ioredis;
    } catch {
      throw new Error(
        'ioredis is required for RedisCacheBackend. Install it with: npm install ioredis',
      );
    }

    if (this.config.url) {
      this.client = new Redis(this.config.url);
    } else {
      this.client = new Redis({
        host: this.config.host ?? 'localhost',
        port: this.config.port ?? 6379,
        password: this.config.password,
        db: this.config.db ?? 0,
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  private prefixedKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error('RedisCacheBackend is not connected. Call connect() first.');
    }
  }

  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    return this.client.get(this.prefixedKey(key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.ensureConnected();
    const prefixed = this.prefixedKey(key);
    if (ttlMs && ttlMs > 0) {
      await this.client.set(prefixed, value, 'PX', ttlMs);
    } else {
      await this.client.set(prefixed, value);
    }
  }

  async del(key: string): Promise<void> {
    this.ensureConnected();
    await this.client.del(this.prefixedKey(key));
  }

  async keys(pattern: string): Promise<string[]> {
    this.ensureConnected();
    const prefixed = this.prefixedKey(pattern);
    const rawKeys: string[] = await this.client.keys(prefixed);
    const prefix = this.config.keyPrefix;
    return rawKeys.map((k: string) => k.startsWith(prefix) ? k.slice(prefix.length) : k);
  }

  async delMany(keys: string[]): Promise<number> {
    this.ensureConnected();
    if (keys.length === 0) return 0;
    const prefixedKeys = keys.map((k) => this.prefixedKey(k));
    return this.client.del(...prefixedKeys);
  }

  async clear(): Promise<void> {
    this.ensureConnected();
    const allKeys = await this.client.keys(`${this.config.keyPrefix}*`);
    if (allKeys.length > 0) {
      await this.client.del(...allKeys);
    }
  }
}
