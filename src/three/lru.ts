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
