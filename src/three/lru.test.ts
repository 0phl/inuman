import { describe, expect, it } from 'vitest';
import { LruCache } from './lru';

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
