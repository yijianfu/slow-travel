import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://travel.example';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/51sAAAAASUVORK5CYII=', 'base64');
let scratch;
let worker;
let migrations;

before(async () => {
  // Build an isolated copy so the tests also exercise the actual publishing entry
  // point, without overwriting deployment output or using a real storage account.
  scratch = await mkdtemp(path.join(tmpdir(), 'slow-travel-hosted-test-'));
  const inputs = ['slow-travel/hosted', 'slow-travel/server/model.mjs', 'slow-travel/dist', '.openai/hosting.json'];
  for (const name of inputs) {
    const dest = path.join(scratch, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(project, name), dest, { recursive: true });
  }
  execFileSync(process.execPath, [path.join(scratch, 'slow-travel/hosted/build.mjs')]);
  worker = (await import(pathToFileURL(path.join(scratch, 'dist/server/index.js')).href)).default;
  const migrationDir = path.join(project, 'drizzle');
  const files = (await readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  assert.ok(files.length, 'expected the production schema migrations');
  migrations = await Promise.all(files.map(name => readFile(path.join(migrationDir, name), 'utf8')));
});

after(async () => {
  if (scratch && path.dirname(scratch) === path.resolve(tmpdir()) && path.basename(scratch).startsWith('slow-travel-hosted-test-')) {
    await rm(scratch, { recursive: true, force: true });
  }
});

// Run the SQL verbatim. Only adapt the result envelope to the D1 Web API.
function d1(sqlite) {
  function statement(sql, args = []) {
    return {
      bind: (...values) => statement(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } })
    };
  }
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const responses = statements.map(query => query.run());
        sqlite.exec('COMMIT');
        return responses;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function bucket() {
  const files = new Map();
  return {
    async put(key, bytes, { httpMetadata }) {
      files.set(key, { bytes: Uint8Array.from(bytes), httpMetadata });
    },
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return { httpMetadata: file.httpMetadata, body: new Response(file.bytes).body, arrayBuffer: async () => file.bytes.slice().buffer };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...files.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false };
    }
  };
}

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  for (const sql of migrations) db.exec(sql);
  const env = { DB: d1(db), BUCKET: bucket() };
  const pending = [];
  const ctx = { waitUntil: work => pending.push(work) };
  t.after(async () => { try { await Promise.all(pending); } finally { db.close(); } });

  const request = (pathname, { method = 'GET', owner = 'owner-a', json, bytes, tag, requestOrigin = origin } = {}) => {
    const headers = new Headers();
    if (owner) headers.set('oai-authenticated-user-id', owner);
    if (requestOrigin) headers.set('Origin', requestOrigin);
    if (tag) headers.set('If-Match', tag);
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    if (bytes) headers.set('Content-Type', 'image/png');
    const body = json !== undefined ? JSON.stringify(json) : bytes;
    return worker.fetch(new Request(new URL(pathname, origin), { method, headers, body }), env, ctx);
  };

  return {
    request,
    db,
    bucket: env.BUCKET,
    flushCleanup: () => Promise.all(pending),
    async open(owner = 'owner-a') {
      const response = await request('/api/book', { owner });
      assert.equal(response.status, 200);
      return { book: await response.json(), tag: response.headers.get('etag') };
    },
    async upload(image = pixel) {
      const response = await request('/api/photos', { method: 'POST', bytes: image });
      assert.equal(response.status, 201);
      return response.json();
    },
    async share(tripId) {
      const response = await request('/api/share', { method: 'POST', json: { tripId } });
      assert.ok(response.ok);
      const { url } = await response.json();
      const landing = new URL(url);
      assert.equal(landing.origin, origin);
      const matches = /^\/s\/([\w-]+)\/?$/.exec(landing.pathname);
      assert.ok(matches, 'share links must open the frontend /s/:token route');
      return { landing: landing.pathname, endpoint: '/api/shared/' + matches[1] };
    }
  };
}

test('hosted book requires a gateway identity, rejects foreign writes and isolates conflicting edits', async t => {
  const site = fixture(t);
  for (const route of ['/api/book', '/api/backup', '/api/photos/private']) {
    assert.equal((await site.request(route, { owner: null })).status, 401);
  }
  const { book, tag } = await site.open();
  assert.equal(book.trips[0].candidates.length, 15);
  assert.ok(tag);
  const save = { method: 'PUT', json: book, tag };
  assert.equal((await site.request('/api/book', { ...save, requestOrigin: 'https://other.example' })).status, 403);
  assert.equal((await site.request('/api/book', { ...save, tag: undefined })).status, 428);
  const saves = ['第一本', '第二本'].map(title => {
    const draft = structuredClone(book);
    draft.trips[0].title = title;
    return site.request('/api/book', { ...save, json: draft });
  });
  const writes = await Promise.all(saves);
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 412]);
  const committed = await site.open();
  assert.notEqual(committed.tag, tag);
  assert.deepEqual(committed.book, await writes.find(r => r.ok).json());
  assert.deepEqual((await site.open('owner-b')).book, book);
});

test('gateway-weakened revision tags allow current saves and restore but reject stale writes', async t => {
  const site = fixture(t);
  const initial = await site.request('/api/book');
  const book = await initial.json();
  const tag = initial.headers.get('etag');
  book.trips[0].title = '更新南京计划';
  const saved = await site.request('/api/book', {method:'PUT', json:book, tag:'W/' + tag});
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('x-journal-revision'), '2');
  assert.equal((await site.request('/api/book', {method:'PUT', json:book, tag:'W/' + tag})).status, 412);
  const current = await site.request('/api/book');
  assert.equal(current.headers.get('x-journal-revision'), '2');
  const backup = await (await site.request('/api/backup')).json();
  const restored = await site.request('/api/backup', {method:'POST', json:backup, tag:'W/' + current.headers.get('etag')});
  assert.equal(restored.status, 200);
  assert.equal(restored.headers.get('x-journal-revision'), '3');
});

test('hosted photos are owner-scoped, included once in recoverable backups and shared only through the trip snapshot', async t => {
  const site = fixture(t);
  const { book, tag } = await site.open();
  const photo = await site.upload();
  const hidden = await site.upload();
  book.trips[0].plan.push({ id: 'private-plan', day: 1, text: '私密预约', done: false });
  book.trips[0].journal.push({ id: 'entry', day: 1, place: '湖', text: '测试记录', photos: [photo] });
  const save = await site.request('/api/book', { method: 'PUT', json: book, tag });
  assert.equal(save.status, 200);
  const currentTag = save.headers.get('etag');
  assert.equal((await site.request(photo.url, { owner: 'owner-b' })).status, 404);
  const outsider = await site.open('owner-b');
  assert.equal((await site.request('/api/book', { method: 'PUT', json: book, tag: outsider.tag, owner: 'owner-b' })).status, 400);
  const shared = await site.share(book.trips[0].id);
  const page = await site.request(shared.landing, { owner: null });
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /慢慢走/);
  const sharedResponse = await site.request(shared.endpoint, { owner: null });
  assert.equal(sharedResponse.status, 200);
  const snapshot = await sharedResponse.json();
  assert.deepEqual(snapshot.trips[0].plan, []);
  assert.deepEqual(snapshot.trips[0].candidates, []);
  assert.deepEqual(snapshot.sources, []);
  const sharedPhoto = snapshot.trips[0].journal[0].photos[0].url;
  assert.equal(sharedPhoto, shared.endpoint + '/photos/' + photo.id);
  const visible = await site.request(sharedPhoto, { owner: null });
  assert.equal(visible.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await visible.arrayBuffer()), pixel);
  assert.equal((await site.request(shared.endpoint + '/photos/' + hidden.id, { owner: null })).status, 404);
  const backup = await (await site.request('/api/backup')).json();
  assert.deepEqual(backup.book, book);
  assert.equal(backup.photos.length, 1);
  assert.equal(backup.photos[0].data, pixel.toString('base64'));
  const restore = { method: 'POST', tag: currentTag, json: backup };
  assert.equal((await site.request('/api/backup', { ...restore, json: { ...backup, photos: [] } })).status, 400);
  assert.equal((await site.open()).tag, currentTag);
  const restored = await site.request('/api/backup', restore);
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), book);
  assert.equal((await site.request('/api/backup', restore)).status, 412);
  assert.deepEqual(Buffer.from(await (await site.request(photo.url)).arrayBuffer()), pixel);
  assert.equal((await site.request(hidden.url)).status, 404);
  assert.equal((await site.request(sharedPhoto, { owner: null })).status, 404);
  const replacement = await site.share(book.trips[0].id);
  await site.request('/api/share/' + book.trips[0].id, { method: 'DELETE' });
  assert.equal((await site.request(replacement.endpoint, { owner: null })).status, 404);
});

test('deleting a trip retires its share even when an imported or re-created trip reuses the identifier', async t => {
  const site = fixture(t);
  const { book, tag } = await site.open();
  const share = await site.share(book.trips[0].id);
  const removed = await site.request('/api/book', { method: 'PUT', tag, json: { ...book, trips: [] } });
  assert.equal(removed.status, 200);
  assert.equal((await site.request(share.endpoint, { owner: null })).status, 404);
  const readded = await site.request('/api/book', { method: 'PUT', tag: removed.headers.get('etag'), json: book });
  assert.equal(readded.status, 200);
  assert.equal((await site.request(share.endpoint, { owner: null })).status, 404);
});

test('R2 failure during restore leaves the previous photos, version and share intact', async t => {
  const site = fixture(t);
  const { book, tag } = await site.open();
  const photos = [await site.upload(), await site.upload()];
  book.trips[0].journal.push({ id: 'note', day: 1, place: '南京', text: '', photos });
  const saved = await site.request('/api/book', { method: 'PUT', tag, json: book });
  assert.equal(saved.status, 200);
  const currentTag = saved.headers.get('etag');
  const share = await site.share(book.trips[0].id);
  const backup = await (await site.request('/api/backup')).json();
  const put = site.bucket.put.bind(site.bucket);
  let attempts = 0;
  t.mock.method(site.bucket, 'put', async (...args) => {
    if (++attempts === 2) throw new Error('simulated bucket failure');
    return put(...args);
  });
  const restored = await site.request('/api/backup', { method: 'POST', tag: currentTag, json: backup });
  assert.ok(restored.status >= 500);
  assert.equal(attempts, 2);
  await site.flushCleanup();
  const current = await site.open();
  assert.equal(current.tag, currentTag);
  assert.deepEqual(current.book, book);
  assert.equal((await site.request(share.endpoint, { owner: null })).status, 200);
  for (const photo of photos) assert.deepEqual(Buffer.from(await (await site.request(photo.url)).arrayBuffer()), pixel);
  assert.equal((await site.bucket.list({ prefix: '' })).objects.length, 2, 'partially staged restore must release its objects');
});

test('uploads collect expired unreferenced photos while keeping the book and active share snapshots intact', async t => {
  const site = fixture(t);
  const { book, tag } = await site.open();
  const shared = await site.upload();
  const current = await site.upload();
  const orphan = await site.upload();
  book.trips[0].journal.push({ id: 'note', day: 1, place: '南京', text: '', photos: [shared] });
  const saved = await site.request('/api/book', { method: 'PUT', tag, json: book });
  assert.equal(saved.status, 200);
  const share = await site.share(book.trips[0].id);
  book.trips[0].journal[0].photos = [current];
  assert.equal((await site.request('/api/book', { method: 'PUT', tag: saved.headers.get('etag'), json: book })).status, 200);
  site.db.prepare('UPDATE journal_photos SET created_at = ?').run(Math.floor(Date.now() / 1000) - 90000);
  await site.upload();
  await site.flushCleanup();
  assert.equal((await site.request(orphan.url)).status, 404);
  assert.equal((await site.request(current.url)).status, 200);
  assert.equal((await site.request(share.endpoint + '/photos/' + shared.id, { owner: null })).status, 200);
});

test('cloud rejects uploads that would exceed the owner photo storage limit even without a book save', async t => {
  const site = fixture(t);
  await site.open();
  // Provision five ledger entries representing newly uploaded 8 MiB photos. The
  // budget is enforced against stored data, including photos not yet in a trip.
  const insert = site.db.prepare('INSERT INTO journal_photos(owner,album,id,mime,size,created_at) SELECT owner,album,?,\'image/png\',?,? FROM journals WHERE owner=?');
  for (let i = 0; i < 5; i++) insert.run('already-uploaded-' + i, 8 * 1024 * 1024, Math.floor(Date.now() / 1000), 'owner-a');
  const response = await site.request('/api/photos', { method: 'POST', bytes: pixel });
  assert.equal(response.status, 413);
  await site.flushCleanup();
  assert.equal((await site.bucket.list({ prefix: '' })).objects.length, 0);
  assert.equal((await site.request('/api/photos', { owner: 'owner-b', method: 'POST', bytes: pixel })).status, 201);
});
