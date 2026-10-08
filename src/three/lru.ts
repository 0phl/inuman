/** Tiny LRU cache; `onEvict` lets GPU resources (textures) be disposed when they fall out. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly max: number;
  private readonly onEvict?: (value: V, key: K) => void;

  constructor(max: number, onEvict?: (value: V, key: K) => void) {
    this.max = max;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  getOrCreate(key: K, create: () => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = create();
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const evicted = this.map.get(oldest.value) as V;
      this.map.delete(oldest.value);
      this.onEvict?.(evicted, oldest.value);
    }
    return value;
  }

  clear(): void {
    for (const [k, v] of this.map) this.onEvict?.(v, k);
    this.map.clear();
  }
}

/**
 * Reference-counted cache for GPU resources that are on screen. `acquire` hands out the shared
 * value and pins it; `release` unpins it. Pinned values are never disposed, however many there are
 * (a table can show more distinct cards than `capacity`). Unpinned values stay warm for reuse, and
 * only those are disposed — least recently released first — once the cache holds more than
 * `capacity` entries.
 */
export class RefCache<K, V> {
  private readonly entries = new Map<K, { value: V; refs: number }>();
  /** Unpinned keys, least recently released first. */
  private readonly idle = new Set<K>();
  private readonly capacity: number;
  private readonly create: (key: K) => V;
  private readonly dispose: (value: V, key: K) => void;

  constructor(capacity: number, create: (key: K) => V, dispose: (value: V, key: K) => void) {
    this.capacity = capacity;
    this.create = create;
    this.dispose = dispose;
  }

  /** Entries held, pinned or idle. */
  get size(): number {
    return this.entries.size;
  }

  /** How many holders `key` has (0 when idle or absent). */
  refs(key: K): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  acquire(key: K): V {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { value: this.create(key), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs++;
    this.idle.delete(key);
    // A new entry may push the idle ones over capacity.
    this.trim();
    return entry.value;
  }

  /** Releasing more often than acquiring is a no-op (never goes negative). */
  release(key: K): void {
    const entry = this.entries.get(key);
    if (!entry || entry.refs === 0) return;
    entry.refs--;
    if (entry.refs === 0) {
      this.idle.add(key);
      this.trim();
    }
  }

  private trim(): void {
    for (const key of this.idle) {
      if (this.entries.size <= this.capacity) return;
      const entry = this.entries.get(key);
      this.idle.delete(key);
      this.entries.delete(key);
      if (entry) this.dispose(entry.value, key);
    }
  }

  /** Disposes everything, pinned or not (e.g. when the whole stage goes away). */
  clear(): void {
    for (const [key, entry] of this.entries) this.dispose(entry.value, key);
    this.entries.clear();
    this.idle.clear();
  }
}
