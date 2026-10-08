import { describe, expect, it } from 'vitest';
import { LruCache, RefCache } from './lru';

describe('LruCache', () => {
  it('evicts the least recently used entry and reports it', () => {
    const evicted: string[] = [];
    const lru = new LruCache<string, number>(2, (_v, k) => evicted.push(k));
    lru.getOrCreate('a', () => 1);
    lru.getOrCreate('b', () => 2);
    lru.get('a'); // a is now most recent
    lru.getOrCreate('c', () => 3);
    expect(evicted).toEqual(['b']);
    expect(lru.size).toBe(2);
    expect(lru.get('a')).toBe(1);
    expect(lru.get('b')).toBeUndefined();
  });

  it('does not recreate cached values', () => {
    const lru = new LruCache<number, object>(12);
    const first = lru.getOrCreate(1, () => ({}));
    expect(lru.getOrCreate(1, () => ({}))).toBe(first);
  });

  it('clear() evicts everything', () => {
    let n = 0;
    const lru = new LruCache<number, number>(5, () => n++);
    for (let i = 0; i < 4; i++) lru.getOrCreate(i, () => i);
    lru.clear();
    expect(n).toBe(4);
    expect(lru.size).toBe(0);
  });
});

describe('RefCache', () => {
  const make = (capacity: number) => {
    const disposed: number[] = [];
    let created = 0;
    const cache = new RefCache<number, { key: number }>(
      capacity,
      (key) => {
        created++;
        return { key };
      },
      (_v, key) => disposed.push(key),
    );
    return { cache, disposed, created: () => created };
  };

  it('never disposes a value that is still held, even far past capacity', () => {
    const { cache, disposed } = make(3);
    for (let k = 0; k < 20; k++) cache.acquire(k);
    expect(cache.size).toBe(20);
    expect(disposed).toEqual([]);
  });

  it('shares one value per key and counts holders', () => {
    const { cache, created } = make(3);
    const a = cache.acquire(7);
    const b = cache.acquire(7);
    expect(b).toBe(a);
    expect(cache.refs(7)).toBe(2);
    expect(created()).toBe(1);
    cache.release(7);
    expect(cache.refs(7)).toBe(1);
  });

  it('keeps released values warm up to capacity, then disposes the least recently released', () => {
    const { cache, disposed, created } = make(3);
    for (let k = 0; k < 5; k++) cache.acquire(k);
    // Release in this order: 3, 0, 4, 1 (2 stays held).
    for (const k of [3, 0, 4, 1]) cache.release(k);
    // 5 entries, capacity 3: the two released first (3, then 0) go.
    expect(disposed).toEqual([3, 0]);
    expect(cache.size).toBe(3);
    // A warm one comes back without being recreated.
    const before = created();
    cache.acquire(4);
    expect(created()).toBe(before);
    expect(disposed).toEqual([3, 0]);
  });

  it('a new value pushes out idle ones, never held ones', () => {
    const { cache, disposed } = make(2);
    cache.acquire(1);
    cache.acquire(2);
    cache.release(1);
    cache.acquire(3); // 3 entries > 2: only idle 1 can go
    expect(disposed).toEqual([1]);
    expect(cache.has(2) && cache.has(3)).toBe(true);
    cache.acquire(4); // 2 and 3 are held: nothing to dispose
    expect(disposed).toEqual([1]);
    expect(cache.size).toBe(3);
  });

  it('extra releases are ignored', () => {
    const { cache, disposed } = make(1);
    cache.acquire(1);
    cache.release(1);
    cache.release(1);
    cache.release(99);
    expect(cache.refs(1)).toBe(0);
    expect(disposed).toEqual([]);
  });

  it('clear() disposes everything', () => {
    const { cache, disposed } = make(4);
    cache.acquire(1);
    cache.acquire(2);
    cache.release(2);
    cache.clear();
    expect(disposed.sort()).toEqual([1, 2]);
    expect(cache.size).toBe(0);
  });
});
