import type { CacheBackend } from './backend.js';

export interface RedisBackendConfig {
  // redis://localhost:6379
  url?: string;
  // default 'localhost'
  host?: string;
  // default 6379
  port?: number;
  password?: string;
  // default 0
  db?: number;
  // default 'gql-watchdog:'
  keyPrefix?: string;
}

const loadRedis = async (): Promise<any> => {
  const moduleName = 'ioredis';
  // eslint-disable-next-line no-inline-comments -- Webpack requires its chunk name inside import().
  const ioredis = await import(/* webpackChunkName: "ioredis" */ moduleName);
  return ioredis.default ?? ioredis;
};

const ensureConnected = (client: any): void => {
  if (!client) {
    throw new Error('RedisCacheBackend is not connected. Call connect() first.');
  }
};

const prefixedKey = (keyPrefix: string, key: string): string => `${keyPrefix}${key}`;

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
    if (this.client) {
      return;
    }

    let Redis: any;
    try {
      Redis = await loadRedis();
    } catch {
      throw new Error(
        'ioredis is required for RedisCacheBackend. Install it with: npm install ioredis',
      );
    }

    this.client = this.config.url
      ? new Redis(this.config.url)
      : new Redis({
          db: this.config.db ?? 0,
          host: this.config.host ?? 'localhost',
          password: this.config.password,
          port: this.config.port ?? 6379,
        });
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.quit();
    this.client = null;
  }

  async get(key: string): Promise<string | null> {
    ensureConnected(this.client);
    return this.client.get(prefixedKey(this.config.keyPrefix, key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    ensureConnected(this.client);
    const prefixed = prefixedKey(this.config.keyPrefix, key);
    if (ttlMs && ttlMs > 0) {
      await this.client.set(prefixed, value, 'PX', ttlMs);
    } else {
      await this.client.set(prefixed, value);
    }
  }

  async del(key: string): Promise<void> {
    ensureConnected(this.client);
    await this.client.del(prefixedKey(this.config.keyPrefix, key));
  }

  async keys(pattern: string): Promise<string[]> {
    ensureConnected(this.client);
    const prefixed = prefixedKey(this.config.keyPrefix, pattern);
    const rawKeys: string[] = await this.client.keys(prefixed);
    const prefix = this.config.keyPrefix;
    return rawKeys.map((k: string) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
  }

  async delMany(keys: string[]): Promise<number> {
    ensureConnected(this.client);
    if (keys.length === 0) {
      return 0;
    }
    const prefixedKeys = keys.map((key) => prefixedKey(this.config.keyPrefix, key));
    return this.client.del(...prefixedKeys);
  }

  async clear(): Promise<void> {
    ensureConnected(this.client);
    const allKeys = await this.client.keys(`${this.config.keyPrefix}*`);
    if (allKeys.length > 0) {
      await this.client.del(...allKeys);
    }
  }
}
