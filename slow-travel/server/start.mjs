import http from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JournalStore, HttpError } from './store.mjs';
import { validateBook, validatePhoto, validateBackup, referencedPhotos, validId, PHOTO_LIMIT, BOOK_LIMIT, BACKUP_LIMIT } from './model.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultDist = join(packageRoot, 'dist');
const contentTypes = new Map(Object.entries({
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2'
}));

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8',...headers});
  res.end(JSON.stringify(payload));
}

function checked(fn) {
  try { return fn(); }
  catch (error) { throw new HttpError(400,error.message); }
}

async function body(req, maxBytes) {
  if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413,'文件或数据过大');
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413,'文件或数据过大');
    parts.push(chunk);
  }
  return Buffer.concat(parts,size);
}

function mediaType(req) { return (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); }
async function readJson(req, limit) {
  if (mediaType(req) !== 'application/json') throw new HttpError(415,'需要 JSON 格式');
  const bytes = await body(req,limit);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new HttpError(400,'JSON 文件无法读取'); }
}

function bookResponse(res, {book,etag}) { json(res,200,book,{ETag:etag}); }

const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>登录 · 慢慢走</title><style>
body{font:1rem/1.6 system-ui;color:#314c43;background:#f5f4ed;margin:8vh auto;padding:2rem;max-width:30rem}h1{font:2.4rem Georgia,serif}label,input,button{display:block}input,button{box-sizing:border-box;padding:.7rem;margin:.6rem 0;font:inherit;width:100%}button{background:#254c40;color:white;border:0;cursor:pointer}
</style><main><h1>慢慢走</h1><p>登录后编辑你的旅行手账。</p><form method="post" action="/login"><label for="key">个人访问密钥</label><input id="key" name="key" type="password" required autocomplete="current-password"><button>打开我的手账</button></form></main></html>`;

function sessionsFor(ownerKey, secure) {
  const sessions = new Map();
  const digest = value => createHash('sha256').update(value).digest();
  let attempts = 0;
  let retryAfter = 0;
  return {
    allows(req) {
      if (!ownerKey) return true;
      const cookie = /(?:^|;\s*)slow_travel_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
      return Boolean(cookie && (sessions.get(cookie[1]) ?? 0) > Date.now());
    },
    login(key) {
      if (!ownerKey) return '';
      if (Date.now() >= retryAfter) { attempts = 0; retryAfter = Date.now() + 300_000; }
      if (attempts >= 20) throw new HttpError(429,'登录尝试过多，请五分钟后再试');
      if (!timingSafeEqual(digest(key),digest(ownerKey))) {
        attempts++;
        throw new HttpError(403,'访问密钥不正确');
      }
      attempts = 0;
      for (const [token,expires] of sessions) if (expires <= Date.now()) sessions.delete(token);
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(token,Date.now() + 12 * 3600000);
      return 'slow_travel_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (secure ? '; Secure' : '');
    }
  };
}

async function serveStatic(pathname, req, res, directory) {
  if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405,'请求方式无效');
  const shell = pathname === '/' || pathname === '/index.html' || /^\/s\/[A-Za-z0-9_-]{32}$/.test(pathname);
  const allowed = ['/app.js','/styles.css','/favicon.ico'].includes(pathname) ||
    /^\/assets\/(?:[\w-]+\/)*[\w.-]+\.(?:svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname);
  if (!shell && !allowed) throw new HttpError(404,'页面不存在');
  try {
    const root = await realpath(directory);
    const path = await realpath(join(root,shell ? 'index.html' : pathname.slice(1)));
    if (!path.startsWith(root + sep)) throw new HttpError(404,'文件不存在');
    const bytes = await readFile(path);
    res.writeHead(200,{'Content-Type':contentTypes.get(extname(path)),'Content-Length':bytes.byteLength});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404,'文件不存在');
    throw error;
  }
}

export function createJournalServer({dataDir, seed, distDir = defaultDist, publicOrigin = '', ownerKey = ''}) {
  const publicUrl = publicOrigin ? new URL(publicOrigin) : null;
  if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.origin !== publicOrigin || !ownerKey)) {
    throw new Error('外部访问需要 HTTPS 站点 origin（不含末尾斜杠）与个人访问密钥');
  }
  if (ownerKey && ownerKey.length < 32) throw new Error('个人访问密钥至少需要 32 个字符');
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const store = new JournalStore(join(dataDir,'journal.sqlite'),seed);
  const sessions = sessionsFor(ownerKey, Boolean(publicUrl));
  const server = http.createServer({requestTimeout:120000, headersTimeout:20000}, async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const host = (req.headers.host || '').toLowerCase();
      const port = server.address().port;
      const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const allowedHost = publicUrl ? host === publicUrl.host : loopback && ['localhost','127.0.0.1','[::1]'].some(h => host === h + ':' + port || (port === 80 && host === h));
      if (!allowedHost) throw new HttpError(403,'站点地址无效');
      const origin = publicUrl?.origin ?? 'http://' + host;
      const mutates = !['GET','HEAD'].includes(req.method);
      if (mutates && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')) {
        throw new HttpError(403,'请求来自其他站点');
      }
      const pathname = new URL(req.url, origin).pathname;
      const method = req.method;
      if (pathname === '/login') {
        if (method === 'POST') {
          if (mediaType(req) !== 'application/x-www-form-urlencoded') throw new HttpError(415,'登录表单格式无效');
          const key = new URLSearchParams((await body(req,4096)).toString()).get('key') || '';
          const cookie = sessions.login(key);
          if (cookie) res.setHeader('Set-Cookie',cookie);
          res.writeHead(303,{Location:'/'});
          return res.end();
        }
        if (method !== 'GET') throw new HttpError(405,'请求方式无效');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        return res.end(loginPage);
      }
      if (!pathname.startsWith('/api/')) return await serveStatic(pathname,req,res,distDir);
      const shared = /^\/api\/shared\/([A-Za-z0-9_-]{32})(?:\/photos\/([A-Za-z0-9_-]{1,100}))?$/.exec(pathname);
      if (shared) {
        if (method !== 'GET') throw new HttpError(405,'此分享仅供阅读');
        const snapshot = store.shared(shared[1]);
        if (!shared[2]) return json(res,200,snapshot);
        if (!referencedPhotos(snapshot).has(shared[2])) throw new HttpError(404,'照片不存在');
        const photo = store.photo(shared[2]);
        res.writeHead(200,{'Content-Type':photo.mime});
        return res.end(photo.bytes);
      }
      if (!sessions.allows(req)) throw new HttpError(401,'请先登录个人手账');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403,'请从手账内访问');
      if (pathname === '/api/book') {
        if (method === 'GET') return bookResponse(res,store.readBook());
        if (method === 'PUT') {
          const raw = await readJson(req,BOOK_LIMIT);
          return bookResponse(res,store.saveBook(checked(() => validateBook(raw)),req.headers['if-match']));
        }
      }
      if (pathname === '/api/photos' && method === 'POST') {
        const bytes = await body(req,PHOTO_LIMIT);
        const mime = checked(() => validatePhoto(bytes,mediaType(req)));
        return json(res,201,store.storePhoto(mime,bytes));
      }
      const photoId = /^\/api\/photos\/([\w-]{1,100})$/.exec(pathname)?.[1];
      if (photoId && method === 'GET') {
        const photo = store.photo(photoId);
        res.writeHead(200,{'Content-Type':photo.mime});
        return res.end(photo.bytes);
      }
      if (pathname === '/api/backup') {
        if (method === 'GET') return json(res,200,store.backup(),{'Content-Disposition':'attachment; filename="slow-travel-backup.json"'});
        if (method === 'POST') {
          const raw = await readJson(req,BACKUP_LIMIT);
          return bookResponse(res,store.restore(checked(() => validateBackup(raw)),req.headers['if-match']));
        }
      }
      if (pathname === '/api/share' && method === 'POST') {
        const payload = await readJson(req,2048);
        if (!validId(payload?.tripId)) throw new HttpError(400,'旅行标识无效');
        return json(res,200,{url:origin + '/s/' + store.publish(payload.tripId)});
      }
      const tripId = /^\/api\/share\/([\w-]{1,100})$/.exec(pathname)?.[1];
      if (tripId && method === 'DELETE') {
        store.revoke(tripId);
        return json(res,200,{revoked:true});
      }
      throw new HttpError(404,'接口或请求方式无效');
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (!error.status) console.error('手账请求失败', error.name, error.code || '');
      json(res,error.status ?? 500,{error:error.status ? error.message : '手账服务暂时不可用，请稍后重试'});
    }
  });
  server.once('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.SLOW_TRAVEL_HOST || '127.0.0.1';
  const port = Number(process.env.SLOW_TRAVEL_PORT || 4173);
  const publicOrigin = process.env.SLOW_TRAVEL_ORIGIN || '';
  if (!['127.0.0.1','::1','localhost'].includes(host) && !publicOrigin) {
    throw new Error('监听外部地址前请配置 SLOW_TRAVEL_ORIGIN 和 SLOW_TRAVEL_OWNER_KEY');
  }
  const seed = JSON.parse(readFileSync(join(defaultDist,'content','book.json'),'utf8'));
  const server = createJournalServer({
    dataDir:resolve(process.env.SLOW_TRAVEL_DATA_DIR || join(packageRoot,'..','local-data','slow-travel')),
    seed,publicOrigin,ownerKey:process.env.SLOW_TRAVEL_OWNER_KEY || ''
  });
  server.listen(port,host,() => console.log('慢慢走  ' + (publicOrigin || 'http://' + (host === '::1' ? '[::1]' : host) + ':' + server.address().port)));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => server.close());
}
