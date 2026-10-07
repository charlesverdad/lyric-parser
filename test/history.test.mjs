import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory, baseFromPath, idFromPath, formatWhen, MAX_ENTRIES, HISTORY_KEY,
} from '../js/history.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n, extra = {}) =>
  ({ id: id(n), title: `Song ${n}`, songCount: 1, createdAt: n, updatedAt: n, ...extra });

/** An in-memory Storage with an optional byte budget. */
function memory({ limit = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (v.length > limit) throw new DOMException('full', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => data.delete(k),
  };
}

test('saves and reads an entry back, newest first', () => {
  const h = createHistory({ storage: memory() });
  h.save(entry(1));
  h.save(entry(2));
  assert.deepEqual(h.list().map((e) => e.id), [id(2), id(1)]);
  assert.equal(h.get(id(1)).title, 'Song 1');
  assert.equal(h.get(id(9)), null);
});

test('saving the same id replaces it and keeps createdAt', () => {
  const h = createHistory({ storage: memory() });
  h.save(entry(1));
  h.save(entry(1, { title: 'Renamed', updatedAt: 50, createdAt: 50 }));
  assert.equal(h.list().length, 1);
  assert.equal(h.get(id(1)).title, 'Renamed');
  assert.equal(h.get(id(1)).createdAt, 1);
  assert.equal(h.get(id(1)).updatedAt, 50);
});

test('caps at the maximum, dropping the oldest', () => {
  const h = createHistory({ storage: memory() });
  for (let n = 1; n <= MAX_ENTRIES + 3; n++) h.save(entry(n));
  const ids = h.list().map((e) => e.id);
  assert.equal(ids.length, MAX_ENTRIES);
  assert.equal(ids[0], id(MAX_ENTRIES + 3));
  assert.ok(!ids.includes(id(1)));
});

test('evicts the oldest entries when storage is full, then retries', () => {
  const h = createHistory({ storage: memory({ limit: 600 }) });
  const big = (n) => entry(n, { blob: 'x'.repeat(150) });
  for (let n = 1; n <= 6; n++) assert.equal(h.save(big(n)), true);
  const ids = h.list().map((e) => e.id);
  assert.ok(ids.length < 6 && ids.length >= 1);
  assert.equal(ids[0], id(6), 'the newest survives');
});

test('an entry too big for storage is reported, not thrown', () => {
  const h = createHistory({ storage: memory({ limit: 10 }) });
  assert.equal(h.save(entry(1)), false);
  assert.deepEqual(h.list(), []);
});

test('tolerates corrupt or wrongly-shaped JSON', () => {
  for (const raw of ['{not json', '{"a":1}', 'null', '[1,"x",{"id":"nope"}]']) {
    const storage = memory();
    storage.data.set(HISTORY_KEY, raw);
    const h = createHistory({ storage });
    assert.deepEqual(h.list(), []);
    assert.equal(h.save(entry(1)), true);
    assert.equal(h.list().length, 1);
  }
});

test('works, empty, with no storage or storage that throws', () => {
  const angry = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  for (const storage of [null, angry]) {
    const h = createHistory({ storage });
    assert.deepEqual(h.list(), []);
    assert.equal(h.save(entry(1)), false);
    assert.equal(h.get(id(1)), null);
    assert.equal(h.remove(id(1)), false);
  }
});

test('remove deletes one entry only', () => {
  const h = createHistory({ storage: memory() });
  h.save(entry(1));
  h.save(entry(2));
  h.remove(id(1));
  assert.deepEqual(h.list().map((e) => e.id), [id(2)]);
});

test('list returns summaries without the heavy state', () => {
  const h = createHistory({ storage: memory() });
  h.save(entry(1, { songs: [{ a: 1 }] }));
  assert.equal('songs' in h.list()[0], false);
  assert.ok(h.get(id(1)).songs);
});

test('baseFromPath finds the served directory from any app path', () => {
  assert.equal(baseFromPath('/'), '/');
  assert.equal(baseFromPath('/index.html'), '/');
  assert.equal(baseFromPath('/lyric-parser/'), '/lyric-parser/');
  assert.equal(baseFromPath(`/lyric-parser/${id(1)}`), '/lyric-parser/');
  assert.equal(baseFromPath(`/${id(1)}`), '/');
});

test('idFromPath only accepts a uuid as the last segment', () => {
  assert.equal(idFromPath(`/lyric-parser/${id(7)}`), id(7));
  assert.equal(idFromPath(`/${id(7)}`), id(7));
  assert.equal(idFromPath('/lyric-parser/'), null);
  assert.equal(idFromPath('/lyric-parser/not-a-uuid'), null);
  assert.equal(idFromPath('/'), null);
});

test('formatWhen gives short relative dates', () => {
  const now = Date.UTC(2026, 5, 15, 12);
  assert.equal(formatWhen(now - 5_000, now), 'just now');
  assert.equal(formatWhen(now - 5 * 60_000, now), '5 min ago');
  assert.equal(formatWhen(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(formatWhen(now - 30 * 3_600_000, now), 'Yesterday');
  assert.match(formatWhen(now - 10 * 86_400_000, now), /^\d{1,2} \w{3}$/);
});
