import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { guideDataDirectory, guideImageType, isGuideImageSegment, nestedGuideImageType } from './guide-images.js';

const directory = import.meta.dirname;
const guidesDirectory = join(directory, '../guides');
const dependencies = join(directory, 'node_modules');
const modules = ['app.js', 'markdown.js', 'guide-images.js', 'catalog-search.js', 'next-arm.js', 'arm-scene.js'];
const files = new Map(
  ['index.html', ...modules, 'styles.css', 'assets/so101-next.webp',
    'assets/so101-model.bin', 'assets/SO-101-LICENSE.txt']
    .map(name => [name, join(directory, name)]),
);
files.set('lib/markdown.js', join(dependencies, 'markdown-it/dist/markdown-it.min.js'));
const katexDist = join(dependencies, 'katex/dist');
files.set('lib/katex.js', join(katexDist, 'katex.min.js'));
files.set('lib/katex.css', join(katexDist, 'katex.min.css'));
for (const font of await readdir(join(katexDist, 'fonts'))) {
  if (font.endsWith('.woff2')) files.set('lib/fonts/' + font, join(katexDist, 'fonts', font));
}
files.set('lib/katex-LICENSE.txt', join(dependencies, 'katex/LICENSE'));
files.set('lib/texmath.js', join(dependencies, 'markdown-it-texmath/texmath.js'));
files.set('lib/texmath-LICENSE.txt', join(dependencies, 'markdown-it-texmath/license.txt'));
files.set('lib/prism.js', join(dependencies, 'prismjs/prism.js'));
for (const language of ['bash', 'docker', 'python']) {
  files.set(`lib/${language}.js`, join(dependencies, `prismjs/components/prism-${language}.min.js`));
}
for (const subset of ['cyrillic', 'latin']) {
  files.set(`fonts/golos-text-${subset}.woff2`, join(dependencies, `@fontsource-variable/golos-text/files/golos-text-${subset}-wght-normal.woff2`));
  files.set(`fonts/mono-${subset}.woff2`, join(dependencies, `@fontsource/ibm-plex-mono/files/ibm-plex-mono-${subset}-400-normal.woff2`));
}

function isGuide(name) {
  return /^[^.].*\.(md|markdown)$/i.test(name) && !/[\/\\\x00]/.test(name);
}

function guideFileType(name) {
  if (isGuide(name)) return 'text/plain; charset=utf-8';
  return guideImageType(name) ?? nestedGuideImageType(name);
}

async function guideFileNames(root = guidesDirectory) {
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.filter(entry => entry.isFile() && guideFileType(entry.name))
    .map(entry => entry.name);

  if (entries.some(entry => entry.name === guideDataDirectory && entry.isDirectory())) {
    const dataRoot = join(root, guideDataDirectory);
    const articleDirectories = await readdir(dataRoot, { withFileTypes: true });
    const images = await Promise.all(articleDirectories
      .filter(entry => entry.isDirectory() && isGuideImageSegment(entry.name))
      .map(async article => {
        const files = await readdir(join(dataRoot, article.name), { withFileTypes: true });
        return files.filter(file => file.isFile())
          .map(file => guideDataDirectory + '/' + article.name + '/' + file.name)
          .filter(nestedGuideImageType);
      }));
    names.push(...images.flat());
  }

  return names.sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));
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
  await Promise.all(names.map(async name => {
    const target = join(outputGuides, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(guidesDirectory, name), target);
  }));
  const current = new Set(names);
  const previous = await guideFileNames(outputGuides);
  await Promise.all(previous.filter(name => !current.has(name)).map(name => rm(join(outputGuides, name))));
  const articles = names.filter(isGuide);
  const manifest = JSON.stringify(articles, null, 2) + '\n';
  await writeFile(join(outputGuides, 'index.json'), manifest);

  const revision = createHash('sha256').update(manifest);
  for (const [name, source] of files) {
    if (/\.(?:js|css|html)$/.test(name)) {
      revision.update(createHash('sha256').update(await readFile(source)).digest());
    }
  }
  for (const filename of articles) {
    const markdown = await readFile(join(outputGuides, filename));
    revision.update(createHash('sha256').update(markdown).digest());
  }
  const indexPath = join(output, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  const version = '?v=' + revision.digest('hex').slice(0, 16);
  await writeFile(indexPath, index.replace(/((?:src|href)="\.\/[\w/-]+\.(?:js|css))(?=")/g, '$1' + version));
  await Promise.all(modules.map(async name => {
    const path = join(output, name);
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace(/((?:from |import\()'\.\/[\w-]+\.js)(?=')/g, '$1' + version));
  }));
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
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' https: http:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
        const safeParents = !filename.includes('/') || (
          (await lstat(join(guidesDirectory, guideDataDirectory))).isDirectory()
          && (await lstat(dirname(file))).isDirectory()
        );
        if (safeParents && (await lstat(file)).isFile()) {
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
