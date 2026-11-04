// Bundle the same authored pages, seed, and validation as the local edition.
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pages = path.join(root, 'slow-travel/dist');
const output = path.join(root, 'dist');
const files = {};
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

async function collect(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute);
    } else if (entry.isFile() && mime[path.extname(entry.name)]) {
      const url = '/' + path.relative(pages, absolute).split(path.sep).join('/');
      files[url] = [mime[path.extname(entry.name)], (await readFile(absolute)).toString('base64')];
    }
  }
}
await collect(pages);
for (const required of ['/index.html','/app.js','/styles.css','/content/book.json','/assets/china-map.svg','/assets/cities.js','/assets/city-map.js','/assets/atlas.js','/assets/city-pages.js','/assets/atlas.css','/assets/nanjing-cover.webp']) {
  if (!files[required]) throw new Error('Missing page resource: ' + required);
}
const model = await readFile(path.join(root, 'slow-travel/server/model.mjs'), 'utf8');
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
const seed = JSON.parse(await readFile(path.join(pages, 'content/book.json'), 'utf8'));
// Keep the domain model in its own scope, so its private helpers never collide
// with adapter helpers. The published Worker is a single dependency-free ESM.
const api = ['validateBook','validatePhoto','referencedPhotos','shareSnapshot','presentShared','validateBackup','BOOK_LIMIT','PHOTO_LIMIT','BACKUP_LIMIT'];
const bundled = 'const MODEL = (() => {\n' + model.replace(/^export /gm, '') +
  '\nreturn {' + api.join(',') + '};\n})();\nconst STATIC_FILES = ' + JSON.stringify(files) +
  ';\nconst SEED = ' + JSON.stringify(seed) + ';\n' + worker;
await mkdir(path.join(output, 'server'), {recursive:true});
await mkdir(path.join(output, '.openai'), {recursive:true});
await writeFile(path.join(output, 'server/index.js'), bundled);
await copyFile(path.join(root, '.openai/hosting.json'), path.join(output, '.openai/hosting.json'));
console.log('Worker built with ' + Object.keys(files).length + ' page resources.');
