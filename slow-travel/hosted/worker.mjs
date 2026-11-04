// MODEL, SEED and STATIC_FILES are supplied by build.mjs at publication.
const responseHeaders = {
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'permissions-policy': 'geolocation=(), camera=(), microphone=()'
};
const albumLimit = 20 * 1024 * 1024;
const storedPhotoCountLimit = 2048;
const importLimit = 32 * 1024 * 1024;
const textLimit = 1500 * 1024;
const etag = rev => '"' + rev + '"';
const photoKey = (owner, album, id) => [encodeURIComponent(owner), album, id].join('/');

class HttpProblem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function reject(status, message) { throw new HttpProblem(status, message); }
function reply(value, status = 200, headers = {}) {
  const revisionHeaders = headers.etag ? {'x-journal-revision':headers.etag.slice(1,-1)} : {};
  return Response.json(value, {status, headers: {...responseHeaders, ...headers, ...revisionHeaders}});
}
function validated(fn, ...args) {
  try { return fn(...args); } catch (err) { reject(400, err.message || '内容格式有误'); }
}
async function bodyBytes(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) reject(413, '文件超出本次上传限制');
  const reader = request.body?.getReader();
  if (!reader) reject(400, '缺少内容');
  const chunks = [];
  let size = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); reject(413, '文件超出本次上传限制'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
  return bytes;
}
async function bodyJson(request, limit) {
  if (!request.headers.get('content-type')?.includes('application/json')) reject(415, '请选择 JSON 文件');
  const bytes = await bodyBytes(request, limit);
  return validated(JSON.parse, new TextDecoder().decode(bytes));
}
function checkedText(book) {
  const text = JSON.stringify(book);
  if (new TextEncoder().encode(text).length > textLimit) reject(413, '手账文字总量超过线上版本的限制');
  return text;
}
async function journal(db, owner) {
  let row = await db.prepare('SELECT revision, album, body FROM journals WHERE owner=?').bind(owner).first();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO journals(owner,revision,album,body) VALUES(?,1,?,?)')
      .bind(owner, crypto.randomUUID(), JSON.stringify(SEED)).run();
    row = await db.prepare('SELECT revision, album, body FROM journals WHERE owner=?').bind(owner).first();
  }
  return row;
}
function checkRevision(request, row) {
  if (!request.headers.has('if-match')) reject(428, '请先重新读取手账');
  // The gateway may weaken ETags after compression. The numeric value is an
  // application revision, also checked atomically by the database update.
  const supplied = request.headers.get('if-match').replace(/^W\//, '');
  if (supplied !== etag(row.revision)) reject(412, '手账已在另一页修改，请重新读取后重试');
}
async function listedPhotos(db, owner, album, book) {
  const ids = [...MODEL.referencedPhotos(book)];
  const rows = await db.prepare('SELECT id,mime,size FROM journal_photos WHERE owner=? AND album=? AND retiring=0 AND id IN (SELECT value FROM json_each(?))')
    .bind(owner, album, JSON.stringify(ids)).all();
  if (rows.results.length !== ids.length) reject(400, '照片尚未保存成功，请重选照片');
  if (rows.results.reduce((n, p) => n + p.size, 0) > albumLimit) reject(413, '线上手账照片合计上限为 20 MB，请减少照片或先压缩');
  return rows.results;
}
async function replaceBook(env, owner, row, book) {
  const photos = await listedPhotos(env.DB, owner, row.album, book);
  const photoIds = JSON.stringify(photos.map(p => p.id));
  // Recheck photo availability at commit so cleanup cannot retire a photo
  // between checking the submitted book and installing its new references.
  const update = env.DB.prepare(`
    UPDATE journals SET body=?, revision=revision+1
    WHERE owner=? AND album=? AND revision=? AND
      (SELECT COUNT(*) FROM journal_photos WHERE owner=? AND album=? AND retiring=0
       AND id IN (SELECT value FROM json_each(?)))=?`)
    .bind(checkedText(book),owner,row.album,row.revision,owner,row.album,photoIds,photos.length);
  const [result] = await env.DB.batch([update,removeObsoleteShares(env.DB,owner)]);
  if (!result.meta.changes) reject(412, '手账或所选照片已变更，请重新读取');
  return reply(book, 200, {etag:etag(row.revision + 1)});
}

function removeObsoleteShares(db, owner) {
  // Compare against the committed book, even when the preceding CAS fails.
  return db.prepare(`
    DELETE FROM journal_shares WHERE owner=? AND NOT EXISTS (
      SELECT 1 FROM journals AS j, json_each(j.body,'$.trips') AS t
      WHERE j.owner=journal_shares.owner AND j.album=journal_shares.album
        AND json_extract(t.value,'$.id')=journal_shares.trip_id
    )`).bind(owner);
}

async function collectUnusedPhotos(env, owner, album) {
  // Durable retirement is the exclusion lock for writers and a retry marker
  // if a bulk object deletion is interrupted.
  const referencesIn = table => `
    SELECT json_extract(p.value,'$.id')
    FROM ${table} AS b, json_each(b.body,'$.trips') AS t,
      json_each(t.value,'$.journal') AS e, json_each(e.value,'$.photos') AS p
    WHERE b.owner=? AND b.album=?
    UNION ALL
    SELECT json_extract(t.value,'$.cover.id')
    FROM ${table} AS b, json_each(b.body,'$.trips') AS t
    WHERE b.owner=? AND b.album=? AND json_extract(t.value,'$.cover.id') IS NOT NULL`;
  await env.DB.prepare(`
    UPDATE journal_photos SET retiring=1
    WHERE owner=? AND album=? AND retiring=0 AND created_at < unixepoch()-86400
      AND id NOT IN (${referencesIn('journals')} UNION ALL ${referencesIn('journal_shares')})`)
    .bind(owner,album,owner,album,owner,album,owner,album,owner,album).run();
  const retired = await env.DB.prepare('SELECT id FROM journal_photos WHERE owner=? AND album=? AND retiring=1 LIMIT 256')
    .bind(owner,album).all();
  const ids = retired.results.map(p => p.id);
  if (!ids.length) return;
  await env.BUCKET.delete(ids.map(id => photoKey(owner,album,id)));
  await env.DB.prepare('DELETE FROM journal_photos WHERE owner=? AND album=? AND retiring=1 AND id IN (SELECT value FROM json_each(?))')
    .bind(owner,album,JSON.stringify(ids)).run();
}

async function upload(request, env, owner, album) {
  const bytes = await bodyBytes(request, MODEL.PHOTO_LIMIT);
  const mime = validated(MODEL.validatePhoto, bytes, request.headers.get('content-type') || '');
  const id = crypto.randomUUID();
  const key = photoKey(owner, album, id);
  await collectUnusedPhotos(env,owner,album);
  const reserve = await env.DB.prepare(`
    INSERT INTO journal_photos(owner,album,id,mime,size)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM journals WHERE owner=? AND album=?)
      AND (SELECT COALESCE(SUM(size),0) FROM journal_photos WHERE owner=? AND album=?) + ? <= ?
      AND (SELECT COUNT(*) FROM journal_photos WHERE owner=? AND album=?) < ?`)
    .bind(owner,album,id,mime,bytes.length,owner,album,owner,album,bytes.length,albumLimit*2,owner,album,storedPhotoCountLimit).run();
  if (!reserve.meta.changes) {
    const active = await env.DB.prepare('SELECT 1 FROM journals WHERE owner=? AND album=?').bind(owner,album).first();
    if (!active) reject(412,'手账刚刚恢复过，请重新选择照片');
    reject(413,'照片空间已满。请整理手账与分享，未使用的上传会在一天后随下次上传清理');
  }
  try {
    await env.BUCKET.put(key, bytes, {httpMetadata:{contentType:mime}});
    const active = await env.DB.prepare('SELECT 1 FROM journals WHERE owner=? AND album=?').bind(owner,album).first();
    if (!active) reject(412, '手账刚刚恢复过，请重新选择照片');
  } catch (err) {
    await env.DB.prepare('UPDATE journal_photos SET retiring=1 WHERE owner=? AND album=? AND id=?').bind(owner,album,id).run();
    await env.BUCKET.delete(key);
    await env.DB.prepare('DELETE FROM journal_photos WHERE owner=? AND album=? AND id=?').bind(owner,album,id).run();
    throw err;
  }
  return reply({id, url:'/api/photos/' + id, caption:''}, 201);
}
async function servePhoto(env, owner, album, id) {
  const file = await env.BUCKET.get(photoKey(owner, album, id));
  if (!file) reject(404, '找不到照片');
  return new Response(file.body, {headers:{...responseHeaders,'content-type':file.httpMetadata.contentType}});
}
function encodeBytes(bytes) {
  // Each complete block ends on a base64 boundary.
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 12288) blocks.push(btoa(String.fromCharCode(...bytes.subarray(i,i+12288))));
  return blocks.join('');
}
async function download(env, owner, row) {
  const book = JSON.parse(row.body);
  const photos = await listedPhotos(env.DB, owner, row.album, book);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = text => controller.enqueue(encoder.encode(text));
      try {
        send('{"format":"slow-travel-backup","version":1,"book":' + row.body + ',"photos":[');
        for (const [idx,p] of photos.entries()) {
          const file = await env.BUCKET.get(photoKey(owner,row.album,p.id));
          if (!file) throw new Error('照片读取失败');
          const data = encodeBytes(new Uint8Array(await file.arrayBuffer()));
          send((idx ? ',' : '') + JSON.stringify({id:p.id,mime:p.mime,data}));
        }
        send(']}'); controller.close();
      } catch (err) { controller.error(err); }
    }
  });
  return new Response(stream,{headers:{...responseHeaders,'content-type':'application/json','content-disposition':'attachment; filename="slow-travel-backup.json"'}});
}
async function cleanupAlbum(env, owner, album) {
  // A database response can be lost after commit. Confirm the target album is
  // no longer current before cleaning objects from a failed restore attempt.
  const live = await env.DB.prepare('SELECT 1 FROM journals WHERE owner=? AND album=?').bind(owner,album).first();
  if (live) return;
  const prefix = photoKey(owner,album,'');
  let cursor;
  do {
    const page = await env.BUCKET.list({prefix,cursor});
    if (page.objects.length) await env.BUCKET.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM journal_photos WHERE owner=? AND album=?').bind(owner,album).run();
}
async function restore(request, env, owner, row, ctx) {
  const parsed = validated(MODEL.validateBackup, await bodyJson(request, importLimit));
  const {book, photos} = parsed;
  const text = checkedText(book);
  if (photos.length > storedPhotoCountLimit) reject(413,'线上相册最多可保存 2048 张照片');
  if (photos.reduce((n,p) => n + p.bytes.length, 0) > albumLimit) reject(413, '线上照片备份上限为 20 MB');
  const album = crypto.randomUUID();
  try {
    for (const p of photos) {
      await env.BUCKET.put(photoKey(owner,album,p.id),p.bytes,{httpMetadata:{contentType:p.mime}});
      await env.DB.prepare('INSERT INTO journal_photos(owner,album,id,mime,size) VALUES(?,?,?,?,?)').bind(owner,album,p.id,p.mime,p.bytes.length).run();
    }
    const swap = env.DB.prepare('UPDATE journals SET album=?, body=?, revision=revision+1 WHERE owner=? AND album=? AND revision=?')
      .bind(album,text,owner,row.album,row.revision);
    const [update] = await env.DB.batch([swap,removeObsoleteShares(env.DB,owner)]);
    if (!update.meta.changes) reject(412, '手账内容已变更，请重新读取后恢复');
  } catch (err) { ctx.waitUntil(cleanupAlbum(env,owner,album)); throw err; }
  ctx.waitUntil(cleanupAlbum(env,owner,row.album));
  return reply(book,200,{etag:etag(row.revision+1)});
}
async function readShare(env, token, photo) {
  const row = await env.DB.prepare('SELECT s.owner,s.album,s.body FROM journal_shares s JOIN journals j ON j.owner=s.owner AND j.album=s.album WHERE s.token=? AND EXISTS (SELECT 1 FROM json_each(j.body,\'$.trips\') WHERE json_extract(value,\'$.id\')=s.trip_id)')
    .bind(token).first();
  if (!row) reject(404,'分享已撤销或已失效');
  const book = JSON.parse(row.body);
  if (!photo) return reply(MODEL.presentShared(book,token));
  if (!MODEL.referencedPhotos(book).has(photo)) reject(404,'找不到照片');
  return servePhoto(env,row.owner,row.album,photo);
}
function staticPage(pathname) {
  const key = pathname === '/' || /^\/s\/[\w-]+\/?$/.test(pathname) ? '/index.html' : pathname;
  const file = STATIC_FILES[key];
  if (!file) reject(404,'页面不存在');
  const bytes = Uint8Array.from(atob(file[1]), c => c.charCodeAt(0));
  return new Response(bytes,{headers:{...responseHeaders,'content-type':file[0]}});
}
async function dispatch(request, env, ctx) {
  const url = new URL(request.url);
  const route = url.pathname;
  const method = request.method;
  if (!route.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') reject(405,'不支持此操作');
    const page = staticPage(route);
    return method === 'HEAD' ? new Response(null,{headers:page.headers}) : page;
  }
  if (!['GET','HEAD'].includes(method) && request.headers.get('origin') !== url.origin) reject(403,'请求来源不匹配');
  const share = route.match(/^\/api\/shared\/([\w-]+)(?:\/photos\/([\w-]+))?$/);
  if (share && method === 'GET') return readShare(env,share[1],share[2]);
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) reject(401,'请登录后打开个人手账');
  const row = await journal(env.DB,owner);
  if (route === '/api/book') {
    if (method === 'GET') return reply(MODEL.validateBook(JSON.parse(row.body)),200,{etag:etag(row.revision)});
    if (method === 'PUT') {
      checkRevision(request,row);
      return replaceBook(env,owner,row,validated(MODEL.validateBook,await bodyJson(request,MODEL.BOOK_LIMIT)));
    }
  }
  if (route === '/api/photos' && method === 'POST') return upload(request,env,owner,row.album);
  const photo = route.match(/^\/api\/photos\/([\w-]+)$/);
  if (photo && method === 'GET') return servePhoto(env,owner,row.album,photo[1]);
  if (route === '/api/backup') {
    if (method === 'GET') return download(env,owner,row);
    if (method === 'POST') { checkRevision(request,row); return restore(request,env,owner,row,ctx); }
  }
  if (route === '/api/share' && method === 'POST') {
    const {tripId} = await bodyJson(request,4096);
    const snapshot = MODEL.shareSnapshot(JSON.parse(row.body),tripId);
    if (!snapshot) reject(404,'找不到旅行');
    const saved = await env.DB.prepare(`
      INSERT INTO journal_shares(token,owner,trip_id,album,body)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM journals WHERE owner=? AND album=? AND revision=?)
      ON CONFLICT(owner,trip_id) DO UPDATE SET album=excluded.album,body=excluded.body RETURNING token`)
      .bind(crypto.randomUUID(),owner,tripId,row.album,checkedText(snapshot),owner,row.album,row.revision).first();
    if (!saved) reject(412,'旅行已变更，请重新读取后再分享');
    return reply({url:new URL('/s/'+saved.token,url).href,audience:'owner-private'});
  }
  if (method === 'DELETE' && route.startsWith('/api/share/')) {
    await env.DB.prepare('DELETE FROM journal_shares WHERE owner=? AND trip_id=?').bind(owner,decodeURIComponent(route.slice(11))).run();
    return reply({ok:true});
  }
  reject(404,'接口不存在');
}
export default {
  async fetch(request,env,ctx) {
    try { return await dispatch(request,env,ctx); }
    catch (err) {
      if (err instanceof HttpProblem) return reply({error:err.message},err.status);
      console.error('journal request failed', err.name, err.message);
      return reply({error:'暂时无法读取或保存手账，请重试'},500);
    }
  }
};
