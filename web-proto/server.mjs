import { createServer } from 'node:http';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

const directory = import.meta.dirname;
const guidesDirectory = join(directory, '../guides');
const dependencies = join(directory, 'node_modules');
const files = new Map(
  ['index.html', 'app.js', 'markdown.js', 'catalog-search.js', 'next-arm.js', 'arm-scene.js', 'styles.css', 'assets/so101-next.webp',
    'assets/so101-model.bin', 'assets/SO-101-LICENSE.txt']
    .map(name => [name, join(directory, name)]),
);
files.set('lib/markdown.js', join(dependencies, 'markdown-it/dist/markdown-it.min.js'));
files.set('lib/prism.js', join(dependencies, 'prismjs/prism.js'));
for (const language of ['bash', 'docker', 'python']) {
  files.set(`lib/${language}.js`, join(dependencies, `prismjs/components/prism-${language}.min.js`));
}
for (const subset of ['cyrillic', 'latin']) {
  files.set(`fonts/golos-text-${subset}.woff2`, join(dependencies, `@fontsource-variable/golos-text/files/golos-text-${subset}-wght-normal.woff2`));
  files.set(`fonts/mono-${subset}.woff2`, join(dependencies, `@fontsource/ibm-plex-mono/files/ibm-plex-mono-${subset}-400-normal.woff2`));
}

const imageTypes = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function isGuide(name) {
  return /^[^.].*\.(md|markdown)$/i.test(name) && !/[\/\\\x00]/.test(name);
}

function guideFileType(name) {
  if (isGuide(name)) return 'text/plain; charset=utf-8';
  if (!name || name.startsWith('.') || /[\/\\\x00]/.test(name)) return;
  return imageTypes.get(extname(name).toLowerCase());
}

async function guideFileNames() {
  const entries = await readdir(guidesDirectory, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && guideFileType(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));
}

async function build() {
  const output = join(directory, 'dist');
  const outputGuides = join(output, 'guides');
  const names = await guideFileNames();
  await mkdir(outputGuides, { recursive: true });
  await Promise.all([...files].map(async ([name, source]) => {
    const target = join(output, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }));
  await Promise.all(names.map(name => copyFile(join(guidesDirectory, name), join(outputGuides, name))));
  const current = new Set(names);
  const previous = await readdir(outputGuides, { withFileTypes: true });
  await Promise.all(previous.filter(entry => entry.isFile() && guideFileType(entry.name) && !current.has(entry.name))
    .map(entry => rm(join(outputGuides, entry.name))));
  const articles = names.filter(isGuide);
  await writeFile(join(outputGuides, 'index.json'), JSON.stringify(articles, null, 2) + '\n');
  console.log(`Готово: dist/ (Markdown — ${articles.length}, изображения — ${names.length - articles.length})`);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

async function serve(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: http:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!['HEAD', 'GET'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = request.url.split('?')[0];
  if (path === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  const send = (type, body) => response.writeHead(200, { 'Content-Type': type })
    .end(request.method === 'HEAD' ? undefined : body);
  try {
    if (path === '/guides/index.json') {
      send('application/json; charset=utf-8', JSON.stringify((await guideFileNames()).filter(isGuide)));
      return;
    }
    if (path.startsWith('/guides/')) {
      const filename = decodeURIComponent(path.slice('/guides/'.length));
      const type = guideFileType(filename);
      if (type) {
        const file = join(guidesDirectory, filename);
        if ((await lstat(file)).isFile()) {
          send(type, await readFile(file));
          return;
        }
      }
    } else {
      const name = path === '/' ? 'index.html' : path.slice(1);
      const file = files.get(name);
      if (file) {
        send(contentTypes[extname(name)], await readFile(file));
        return;
      }
    }
  } catch {
    response.writeHead(404).end('File not found');
    return;
  }
  response.writeHead(404).end('Not found');
}

if (process.argv.includes('--build')) {
  await build();
} else {
  const server = createServer(serve);
  server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
    console.log(`Вики открыта на http://127.0.0.1:${server.address().port}`);
  });
}
