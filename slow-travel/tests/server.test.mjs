import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJournalServer } from '../server/start.mjs';

const seed = {version:1,sources:[],trips:[{
  id:'trip',title:'南京',city:'南京',startDate:'',days:null,status:'planned',
  candidates:[],plan:[{id:'list',day:1,text:'个人预约信息',done:false}],journal:[]
}]};
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/51sAAAAASUVORK5CYII=','base64');
const jsonOptions = (method, payload, tag) => ({method,headers:{
  'content-type':'application/json', ...(tag ? {'if-match':tag} : {})
},body:JSON.stringify(payload)});

// Browser fetch replaces Host. Use the wire-level HTTP client for rebinding and proxy tests.
async function requestWithHost(url, init) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url,{method:init.method,headers:init.headers},res => {
      const chunks = [];
      res.on('data',chunk => chunks.push(chunk));
      res.once('error',reject);
      res.once('end',() => resolve(new Response(Buffer.concat(chunks),{
        status:res.statusCode,headers:res.headers
      })));
    });
    req.once('error',reject);
    req.end(init.body instanceof URLSearchParams ? init.body.toString() : init.body);
  });
}

async function fixture(t, options={}) {
  const root = await mkdtemp(join(tmpdir(),'slow-travel-test-'));
  const dataDir = join(root,'data');
  const distDir = join(root,'dist');
  await mkdir(distDir);
  await writeFile(join(distDir,'index.html'),'<title>慢慢走</title>');
  await mkdir(join(distDir,'assets'));
  await writeFile(join(distDir,'assets','atlas.css'),'.atlas-paper{position:relative}');
  let server;
  let base;
  async function close() {
    if (!server?.listening) return;
    const stopped = once(server,'close');
    server.close();
    server.closeAllConnections();
    await stopped;
  }
  async function start() {
    server = createJournalServer({dataDir,seed,distDir,...options});
    await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  await start();
  t.after(async () => {
    await close();
    const target = await realpath(root);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('slow-travel-test-'));
    await rm(target,{recursive:true,force:true});
  });
  return {
    request:(path, init={}) => init.headers?.Host ? requestWithHost(base + path,init) : fetch(base + path, init),
    restart:async () => { await close(); await start(); }
  };
}

test('two editors cannot silently overwrite each other; writes and image bytes survive restart', async t => {
  const site = await fixture(t);
  const initial = await site.request('/api/book');
  assert.equal(initial.status,200);
  const originalTag = initial.headers.get('etag');
  const book = await initial.json();
  const upload = await site.request('/api/photos',{method:'POST',headers:{'Content-Type':'image/png'},body:pixel});
  assert.equal(upload.status,201);
  const photo = await upload.json();
  book.trips[0].journal.push({id:'day-1',day:1,place:'湖',text:'风很轻',photos:[photo]});
  const save = () => site.request('/api/book',jsonOptions('PUT',book,originalTag));
  const writes = await Promise.all([save(),save()]);
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,412]);
  await site.restart();
  const current = await site.request('/api/book');
  assert.notEqual(current.headers.get('etag'),originalTag);
  assert.deepEqual((await current.json()).trips,book.trips);
  const bytes = await (await site.request(photo.url)).arrayBuffer();
  assert.deepEqual(Buffer.from(bytes),pixel);
});

test('shares hide private plans, expose only selected photos and are revocable; restore is complete or unchanged', async t => {
  const site = await fixture(t);
  const initial = await site.request('/api/book');
  const book = await initial.json();
  const upload = () => site.request('/api/photos',{method:'POST',headers:{'Content-Type':'image/png'},body:pixel}).then(r=>r.json());
  const visible = await upload();
  const hidden = await upload();
  book.trips[0].journal.push({id:'note',day:2,place:'树下',text:'落叶',photos:[visible]});
  const saved = await site.request('/api/book',jsonOptions('PUT',book,initial.headers.get('etag')));
  const tag = saved.headers.get('etag');
  const share = await site.request('/api/share',jsonOptions('POST',{tripId:'trip'}));
  const token = new URL((await share.json()).url).pathname.split('/').pop();
  const sharedPath = '/api/shared/' + token;
  const published = await (await site.request(sharedPath)).json();
  assert.deepEqual(published.trips[0].plan,[]);
  const sharedPhoto = published.trips[0].journal[0].photos[0].url;
  assert.equal((await site.request(sharedPhoto)).status,200);
  assert.equal((await site.request(sharedPath + '/photos/' + hidden.id)).status,404);
  const backup = await (await site.request('/api/backup')).json();
  assert.equal(backup.photos.length,1);
  assert.equal(backup.photos[0].data,pixel.toString('base64'));
  assert.equal((await site.request('/api/backup',jsonOptions('POST',{...backup,photos:[]},tag))).status,400);
  assert.equal((await site.request('/api/book')).headers.get('etag'),tag);
  assert.equal((await site.request('/api/share/trip',{method:'DELETE'})).status,200);
  assert.equal((await site.request(sharedPhoto)).status,404);
  const empty = await site.request('/api/book',jsonOptions('PUT',seed,tag));
  const restored = await site.request('/api/backup',jsonOptions('POST',backup,empty.headers.get('etag')));
  assert.equal(restored.status,200);
  assert.deepEqual((await restored.json()).trips,book.trips);
  assert.deepEqual(Buffer.from(await (await site.request(visible.url)).arrayBuffer()),pixel);
  assert.equal((await site.request(hidden.url)).status,404);
});

test('local service rejects foreign Host, cross-origin mutations, invalid uploads and private static paths',async t => {
  const site = await fixture(t);
  const atlasStyle=await site.request('/assets/atlas.css');
  assert.equal(atlasStyle.status,200);
  assert.match(atlasStyle.headers.get('content-type'),/text\/css/);
  assert.equal((await site.request('/private/journal.sqlite')).status,404);
  assert.equal((await site.request('/content/book.json')).status,404);
  assert.equal((await site.request('/api/book',{headers:{Host:'attacker.invalid'}})).status,403);
  const foreign = jsonOptions('POST',{tripId:'trip'});
  foreign.headers.origin = 'https://attacker.invalid';
  assert.equal((await site.request('/api/share',foreign)).status,403);
  assert.equal((await site.request('/api/photos',{method:'POST',headers:{'Content-Type':'image/png'},body:'not an image'})).status,400);
  assert.equal((await site.request('/api/book',jsonOptions('PUT',seed))).status,428);
});

test('remote deployment requires owner authentication for private APIs, even when called by direct URL',async t => {
  const ownerKey = '0123456789abcdef0123456789abcdef';
  const origin = 'https://journal.example';
  const site = await fixture(t,{ownerKey,publicOrigin:origin});
  const headers = {Host:'journal.example'};
  assert.equal((await site.request('/api/book',{headers})).status,401);
  assert.equal((await site.request('/api/backup',{headers})).status,401);
  assert.equal((await site.request('/api/photos/test-file',{headers})).status,401);
  const login = await site.request('/login',{method:'POST',redirect:'manual',
    headers:{...headers,'content-type':'application/x-www-form-urlencoded',Origin:origin},
    body:new URLSearchParams({key:ownerKey})});
  assert.equal(login.status,303);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/Secure/);
  assert.equal((await site.request('/api/book',{headers:{...headers,Cookie:cookie.split(';')[0]}})).status,200);
});
