/**
 * Recent parses, kept in localStorage, and the URL scheme that points at them.
 *
 * Pure of the DOM: storage is injected, so every failure mode (quota, corrupt
 * JSON, no storage at all) can be exercised in a test. Nothing here throws.
 */

export const HISTORY_KEY = 'lyric-parser:history:v1';
export const MAX_ENTRIES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isId = (value) => typeof value === 'string' && UUID.test(value);

/**
 * The directory the app is served from, with a trailing slash: "/" locally,
 * "/lyric-parser/" on Pages. A trailing uuid or file name is stripped, so the
 * answer is the same from "/lyric-parser/", ".../index.html" and ".../<uuid>".
 */
export function baseFromPath(pathname) {
  return pathname.replace(/[^/]*$/, '') || '/';
}

/** The parse id in a path like "/lyric-parser/<uuid>", or null for the menu. */
export function idFromPath(pathname) {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return isId(last) ? last.toLowerCase() : null;
}

/** A short, human date: "just now", "5 min ago", "3 h ago", "Yesterday", "12 Mar". */
export function formatWhen(timestamp, now = Date.now()) {
  const diff = now - timestamp;
  if (!Number.isFinite(diff) || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 2 * 86_400_000) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isLines = (v) => Array.isArray(v) && v.every((l) => typeof l === 'string');

/** A laid-out song, in the shape the results screen reads. */
const isSong = (song) =>
  isObject(song)
  && typeof song.title === 'string'
  && Array.isArray(song.warnings)
  && Array.isArray(song.arrangement)
  && Array.isArray(song.groups)
  && song.groups.every((g) => isObject(g) && typeof g.name === 'string'
    && Array.isArray(g.slides) && g.slides.every(isLines));

const isParsedSong = (song) => isObject(song) && Array.isArray(song.groups);

/**
 * Shallow-but-sufficient: restoring a malformed entry would crash the render,
 * so anything with a bad shape is dropped when read.
 */
const isEntry = (e) =>
  isObject(e) && isId(e.id) && Number.isFinite(e.updatedAt)
  && (e.songs === undefined || (Array.isArray(e.songs) && e.songs.every(isSong)))
  && (e.parsed === undefined || (Array.isArray(e.parsed) && e.parsed.every(isParsedSong)));

/**
 * @param {{ storage?: Storage | null, key?: string, max?: number }} options
 *   `storage` may be null or throw on access; the store then simply stays empty.
 */
export function createHistory({ storage = null, key = HISTORY_KEY, max = MAX_ENTRIES } = {}) {
  /** Newest first. Never throws; corrupt data reads as empty. */
  function readAll() {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter(isEntry).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** Write, evicting the oldest entries until it fits. Returns success. */
  function writeAll(entries) {
    let keep = entries.slice(0, max);
    for (;;) {
      try {
        if (!storage) return false;
        storage.setItem(key, JSON.stringify(keep));
        return true;
      } catch {
        if (keep.length <= 1) {
          // Not even one entry fits: drop the data rather than leave stale state.
          try { storage?.removeItem(key); } catch { /* unavailable */ }
          return false;
        }
        keep = keep.slice(0, -1);
      }
    }
  }

  return {
    /** Summaries for the Recent list, newest first. */
    list() {
      return readAll().map(({ id, title, songCount, createdAt, updatedAt }) =>
        ({ id, title, songCount, createdAt, updatedAt }));
    },
    /** The full saved entry, or null. */
    get(id) {
      return readAll().find((e) => e.id === id) ?? null;
    },
    /** Insert or replace an entry (matched by id), keeping `createdAt`. */
    save(entry) {
      const all = readAll();
      const old = all.find((e) => e.id === entry.id);
      const next = { ...entry, createdAt: old?.createdAt ?? entry.createdAt ?? entry.updatedAt };
      return writeAll([next, ...all.filter((e) => e.id !== entry.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt));
    },
    remove(id) {
      return writeAll(readAll().filter((e) => e.id !== id));
    },
  };
}
