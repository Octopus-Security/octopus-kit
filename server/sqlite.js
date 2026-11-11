'use strict';
/**
 * SQLite helpers for Sequelize apps. Zero dependencies (Sequelize is PASSED IN).
 *
 *   sqlitePragmas(sequelize, { wal, busyMs })   pragmas on EVERY new connection
 *   createUserDbCache(factory, { max })         LRU of per-user databases
 */

function pragmaSql({ wal = true, busyMs = 5000 } = {}) {
  const ms = Math.max(0, Math.floor(Number(busyMs)) || 0);
  return [
    wal ? 'PRAGMA journal_mode=WAL;' : null,
    `PRAGMA busy_timeout=${ms};`,
    wal ? 'PRAGMA synchronous=NORMAL;' : null,
  ].filter(Boolean).join(' ');
}

/**
 * Installs the pragmas on every connection the sqlite dialect hands out. Sequelize's sqlite
 * connection manager never fires the `afterConnect` hook (verified: it overrides getConnection
 * and skips the base class's connect path), so this wraps getConnection and tunes each new
 * handle once, tracked in a WeakSet. That covers the default connection AND the separate
 * per-transaction handles. busy_timeout and synchronous are per connection; journal_mode=WAL
 * persists in the file. WAL writes -wal and -shm beside the database, so it must sit in a
 * mounted directory; on a single-file bind mount pass `wal: false`.
 * Returns the SQL it will run. Call before the first query.
 */
function sqlitePragmas(sequelize, opts = {}) {
  const sql = pragmaSql(opts);
  const cm = sequelize.connectionManager;
  const orig = cm.getConnection.bind(cm);
  const tuned = new WeakSet();
  cm.getConnection = async function withPragmas(options) {
    const connection = await orig(options);
    if (!tuned.has(connection)) {
      tuned.add(connection);
      await new Promise((resolve, reject) => connection.exec(sql, (err) => (err ? reject(err) : resolve())));
    }
    return connection;
  };
  return sql;
}

async function closeInstance(inst) {
  try {
    if (inst && typeof inst.close === 'function') await inst.close();
    else if (inst && inst.sequelize && typeof inst.sequelize.close === 'function') await inst.sequelize.close();
  } catch { /* closing is best effort */ }
}

/**
 * LRU cache of per-user database instances.
 *
 * `factory(key)` builds (or returns a promise of) an instance. The key must ALREADY be
 * validated by the caller (the cache never sanitises it). Use `cache.use(key, fn)` so the
 * instance is reference-counted: an evicted instance that a request is still using is
 * closed only after the last release, never under it. `cache.get` / `acquire` are the
 * lower-level forms; every `acquire` must be paired with its `release`.
 */
function createUserDbCache(factory, { max = 200 } = {}) {
  if (typeof factory !== 'function') throw new TypeError('factory must be a function');
  const limit = Math.max(1, Math.floor(max) || 1);
  const map = new Map(); // key -> entry; insertion order = recency (oldest first)

  function evict() {
    for (const [key, e] of map) {
      if (map.size <= limit) break;
      map.delete(key);
      e.evicted = true;
      if (e.refs === 0) e.promise.then(closeInstance, () => {});
    }
  }

  async function acquire(key) {
    let e = map.get(key);
    if (e) { map.delete(key); map.set(key, e); } // touch
    else {
      e = { refs: 0, evicted: false };
      e.promise = Promise.resolve().then(() => factory(key));
      e.promise.catch(() => { if (map.get(key) === e) map.delete(key); });
      map.set(key, e);
      evict();
    }
    e.refs++;
    let db;
    try { db = await e.promise; } catch (err) { e.refs--; throw err; }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      e.refs--;
      if (e.evicted && e.refs === 0) closeInstance(db);
    };
    return { db, release };
  }

  async function use(key, fn) {
    const { db, release } = await acquire(key);
    try { return await fn(db); } finally { release(); }
  }

  async function get(key) {
    const { db, release } = await acquire(key);
    release();
    return db;
  }

  async function clear() {
    const entries = [...map.values()];
    map.clear();
    for (const e of entries) {
      e.evicted = true;
      if (e.refs === 0) await e.promise.then(closeInstance, () => {});
    }
  }

  return { acquire, use, get, clear, get size() { return map.size; }, has: (k) => map.has(k) };
}

module.exports = { sqlitePragmas, createUserDbCache, pragmaSql };
