import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { validateBook, referencedPhotos, shareSnapshot, presentShared, LIBRARY_PHOTO_LIMIT } from './model.mjs';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class JournalStore {
  constructor(path, seed) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shares (trip_id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, snapshot TEXT NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO journal VALUES(1,1,?)').run(JSON.stringify(validateBook(seed)));
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  readBook() {
    const row = this.db.prepare('SELECT revision,body FROM journal WHERE id=1').get();
    return {book:validateBook(JSON.parse(row.body)), etag:'"' + row.revision + '"'};
  }

  assertVersion(tag) {
    if (!tag) throw new HttpError(428,'请重新打开手账后再保存');
    if (tag !== this.readBook().etag) throw new HttpError(412,'手账已有新修改，请重新载入后再保存');
  }

  // Snapshots keep their own photo references when the owner later edits the trip.
  cleanPhotos(book) {
    const keep = referencedPhotos(book);
    for (const row of this.db.prepare('SELECT snapshot FROM shares').iterate()) {
      for (const key of referencedPhotos(JSON.parse(row.snapshot))) keep.add(key);
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const old = this.db.prepare('SELECT id FROM photos WHERE created < ?').all(cutoff);
    const remove = this.db.prepare('DELETE FROM photos WHERE id=?');
    for (const row of old) if (!keep.has(row.id)) remove.run(row.id);
  }

  update(book) {
    this.db.prepare('UPDATE journal SET revision=revision+1, body=? WHERE id=1').run(JSON.stringify(book));
    return this.readBook();
  }

  saveBook(book, tag) {
    return this.transaction(() => {
      this.assertVersion(tag);
      let size = 0;
      const find = this.db.prepare('SELECT length(bytes) AS size FROM photos WHERE id=?');
      for (const key of referencedPhotos(book)) {
        const row = find.get(key);
        if (!row) throw new HttpError(400,'有照片尚未上传或已失效，请重新选择');
        size += row.size;
      }
      if (size > LIBRARY_PHOTO_LIMIT) throw new HttpError(413,'手账照片总量超过 64 MiB');
      const tripIds = new Set(book.trips.map(t => t.id));
      for (const row of this.db.prepare('SELECT trip_id FROM shares').all()) {
        if (!tripIds.has(row.trip_id)) this.revoke(row.trip_id);
      }
      this.cleanPhotos(book);
      return this.update(book);
    });
  }

  storePhoto(mime, bytes) {
    return this.transaction(() => {
      this.cleanPhotos(this.readBook().book);
      const total = this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS size FROM photos').get().size;
      if (total + bytes.length > 2 * LIBRARY_PHOTO_LIMIT) {
        throw new HttpError(413,'可用照片空间不足，请撤销不再使用的分享或通过备份整理照片');
      }
      const id = randomUUID();
      this.db.prepare('INSERT INTO photos VALUES(?,?,?,?)').run(id,mime,bytes,Date.now());
      return {id,url:'/api/photos/' + id,caption:''};
    });
  }

  photo(id) {
    const row = this.db.prepare('SELECT mime,bytes FROM photos WHERE id=?').get(id);
    if (!row) throw new HttpError(404,'照片不存在');
    return row;
  }

  backup() {
    return this.transaction(() => {
      const {book} = this.readBook();
      const photos = Array.from(referencedPhotos(book), id => {
        const {mime,bytes} = this.photo(id);
        return {id,mime,data:Buffer.from(bytes).toString('base64')};
      });
      return {format:'slow-travel-backup',version:1,book,photos};
    });
  }

  restore({book,photos}, tag) {
    return this.transaction(() => {
      this.assertVersion(tag);
      this.db.exec('DELETE FROM shares; DELETE FROM photos;');
      const insert = this.db.prepare('INSERT INTO photos VALUES(?,?,?,?)');
      for (const p of photos) insert.run(p.id,p.mime,p.bytes,Date.now());
      return this.update(book);
    });
  }

  publish(id) {
    return this.transaction(() => {
      const snapshot = shareSnapshot(this.readBook().book,id);
      if (!snapshot) throw new HttpError(404,'旅行不存在');
      const existing = this.db.prepare('SELECT token FROM shares WHERE trip_id=?').get(id);
      const token = existing?.token ?? randomBytes(24).toString('base64url');
      this.db.prepare('INSERT INTO shares VALUES(?,?,?) ON CONFLICT(trip_id) DO UPDATE SET snapshot=excluded.snapshot')
        .run(id,token,JSON.stringify(snapshot));
      return token;
    });
  }

  revoke(id) {
    this.db.prepare('DELETE FROM shares WHERE trip_id=?').run(id);
  }

  shared(token) {
    const row = this.db.prepare('SELECT snapshot FROM shares WHERE token=?').get(token);
    if (!row) throw new HttpError(404,'这份分享已失效');
    return presentShared(JSON.parse(row.snapshot),token);
  }

  close() { this.db.close(); }
}
