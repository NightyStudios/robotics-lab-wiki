import { escapeHtml as h, prepare, slug } from './markdown.js';
import { trackNextArm } from './next-arm.js';
import { bindCatalogSearch, catalogSearch, highlightArticle } from './catalog-search.js';

const guideVersion = new URL(import.meta.url).search;

const guides = [
  { id: 'linux-101', name: 'Linux', filename: 'linux-101.md' },
  { id: 'docker-101', name: 'Docker', filename: 'docker-101.md' },
];
const guideIcons = {
  'linux-101': '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m6.5 9 3 3-3 3m6 0h5"/>',
  'docker-101': '<path d="M2 12h15a4 4 0 0 1 2-4c.5 1 .6 2 .4 2.8H22a4.5 4.5 0 0 1-4 4.2h-.7A8.6 8.6 0 0 1 9 20a7 7 0 0 1-7-7zM5 12V9h3v3m0-3h3v3m0-3V6h3v6"/>',
};
const bookIcon = '<path d="M12 6a7 7 0 0 0-9-1v13a8 8 0 0 1 9 1 8 8 0 0 1 9-1V5a7 7 0 0 0-9 1zm0 0v13"/>';
const robotThoughts = [
  ['Нужно что-то найти?', 'Нажми на меня'],
  ['Бип-боп-буп.', 'Это я думаю.'],
  ['Заходят байт, килобайт и мегабайт в прогресс-бар.', 'Бармен: «Заказ готов на 99%».'],
  ['Я опять завис?', 'Это пауза для размышлений.'],
  ['У меня отличная память.', 'О чём я только что говорил?'],
  ['Что сказали два провода?', 'Между нами есть контакт.'],
  ['Почему робот взял лестницу?', 'Хотел выйти на новый уровень.'],
  ['Куда робот убрал носки?', 'В папку «Разное».'],
  ['Хотел рассказать шутку про UDP.', 'Не знаю, дошла ли она.'],
  ['Меня попросили говорить тише.', 'Перехожу на шёпот: бип.'],
  ['Учу робота танцевать.', 'Пока он только считает такты.'],
];
const get = id => document.getElementById(id);
let route = locationRoute();
let articles = [];
let loadError = '';
let loaded = false;
let activeSection = '';
let tocObserver;
let stopRobotTracking;
let stopReadingProgress;
let stopNextArm;

function locationRoute() {
  const [fragment, params] = location.hash.replace(/^#\/?/, '').split('?', 2);
  const [mode, encodedId = '', encodedSection = ''] = fragment.split('/');
  if (['wiki', 'workshop', 'reference'].includes(mode)) {
    try {
      const id = decodeURIComponent(encodedId);
      const section = id ? decodeURIComponent(encodedSection) : '';
      const query = id ? new URLSearchParams(params).get('q') ?? '' : '';
      if (mode !== 'wiki') history.replaceState(history.state, '', path(id, section, query));
      return { id, section, query };
    } catch {
      return { id: '', section: '', query: '' };
    }
  }
  return { id: '', section: '', query: '' };
}

function path(id, section, query) {
  const fragment = '#/' + ['wiki', id, section].filter(Boolean).map(encodeURIComponent).join('/');
  return query ? fragment + '?' + new URLSearchParams({ q: query }) : fragment;
}

function articleRows(items) {
  if (!items.length) return '<p class="inline-message">Здесь пока нет материалов.</p>';
  return `<ul class="file-list" role="list">${items.map(article => `<li>
    <a href="${path(article.id)}">
      <span class="file-label">
        <svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${guideIcons[article.id] ?? bookIcon}</svg>
        <strong>${h(article.name)}</strong>
      </span>
    </a>
  </li>`).join('')}</ul>`;
}

function robotFigure() {
  return `<span class="robot" aria-hidden="true">
    <span class="robot-neck"></span>
    <span class="robot-chassis"><span class="robot-dial"></span><span class="robot-vents"></span></span>
    <span class="robot-head">
      <span class="robot-antenna"></span>
      <span class="robot-screen">
        <span class="robot-eyes"><span></span><span></span></span>
      </span>
    </span>
  </span>`;
}

function wikiCatalog() {
  const searchable = articles.length > 0;
  const robot = robotFigure();
  return `
    <h1 class="sr-only">Статьи</h1>
    <div class="catalog-layout"${searchable ? ' data-catalog-search' : ''}>
      <div class="catalog-list wiki-files" data-od-id="wiki-catalog">
        ${articleRows(articles)}
      </div>
      ${searchable ? `
        <div class="catalog-assistant">
          <button class="robot-stage robot-trigger" data-robot type="button"
            aria-label="Чат с роботом" aria-controls="catalog-chat" aria-expanded="false">
            <span class="robot-hint" aria-hidden="true" data-animated>
              ${robotThoughts.map(([line, ending], index) => `<span class="robot-thought"${index === 0 ? ' data-current' : ''}>
                ${h(line)}<strong>${h(ending)}</strong>
              </span>`).join('')}
            </span>
            ${robot}
          </button>
          ${catalogSearch()}
        </div>
      ` : `<div class="robot-stage" data-robot aria-hidden="true">${robot}</div>`}
    </div>`;
}

function trackRobotThoughts(stage, motion, signal) {
  const bubble = stage.querySelector('.robot-hint');
  if (!bubble) return;
  const thoughts = [...bubble.querySelectorAll('.robot-thought')];
  let current = 0;
  let nextJoke = 1;
  let visible = false;
  let timer;

  function show(index) {
    thoughts[current].removeAttribute('data-current');
    current = index;
    thoughts[current].setAttribute('data-current', '');
  }

  function queueThought(delay) {
    timer = setTimeout(() => {
      bubble.setAttribute('data-between-thoughts', '');
      timer = setTimeout(() => {
        show(current === 0 ? nextJoke : 0);
        if (current) nextJoke = current + 1 < thoughts.length ? current + 1 : 1;
        bubble.removeAttribute('data-between-thoughts');
        queueThought(current === 0 ? 6800 : 6100);
      }, 480);
    }, delay);
  }

  function refresh() {
    clearTimeout(timer);
    bubble.removeAttribute('data-between-thoughts');
    show(0);
    const active = visible && !motion.matches && !document.hidden && stage.getAttribute('aria-expanded') === 'false';
    bubble.toggleAttribute('data-animated', active);
    if (active) queueThought(6800);
  }

  const chatObserver = new MutationObserver(refresh);
  chatObserver.observe(stage, { attributeFilter: ['aria-expanded'] });
  const viewportObserver = new IntersectionObserver(([entry]) => {
    visible = entry.intersectionRatio >= .5;
    refresh();
  }, { threshold: .5 });
  viewportObserver.observe(bubble);
  motion.addEventListener('change', refresh, { signal });
  document.addEventListener('visibilitychange', refresh, { signal });
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    chatObserver.disconnect();
    viewportObserver.disconnect();
  }, { once: true });
}

function trackRobot(stage) {
  const events = new AbortController();
  const { signal } = events;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  trackRobotThoughts(stage, motion, signal);
  let frame = 0;
  let lastTime = 0;
  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;

  function draw() {
    stage.style.setProperty('--look-x', x.toFixed(3));
    stage.style.setProperty('--look-y', y.toFixed(3));
  }

  function animate(time) {
    const amount = 1 - Math.exp(-(lastTime ? time - lastTime : 16) / 85);
    lastTime = time;
    x += (targetX - x) * amount;
    y += (targetY - y) * amount;
    if (Math.hypot(targetX - x, targetY - y) > .006) {
      frame = requestAnimationFrame(animate);
    } else {
      x = targetX;
      y = targetY;
      frame = lastTime = 0;
    }
    draw();
  }

  function look(nextX, nextY) {
    targetX = nextX;
    targetY = nextY;
    if (!frame) frame = requestAnimationFrame(animate);
  }

  window.addEventListener('pointermove', event => {
    if (motion.matches || event.pointerType === 'touch') return;
    const box = stage.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return;
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height * .43);
    const distance = Math.max(125, Math.hypot(dx, dy));
    look(dx / distance, dy / distance);
  }, { passive: true, signal });
  window.addEventListener('pointerout', event => {
    if (!motion.matches && event.pointerType !== 'touch' && !event.relatedTarget) look(0, 0);
  }, { passive: true, signal });
  window.addEventListener('blur', () => { if (!motion.matches) look(0, 0); }, { signal });
  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    cancelAnimationFrame(frame);
    frame = lastTime = x = y = targetX = targetY = 0;
    draw();
  }, { signal });

  return () => {
    events.abort();
    cancelAnimationFrame(frame);
  };
}

function collapsedToc(article) {
  if (!article.sections.length) return '';
  const root = { level: 1, children: [] };
  const parents = [root];
  for (const section of article.sections) {
    while (parents.length > 1 && parents.at(-1).level >= section.level) parents.pop();
    const node = { ...section, children: [] };
    parents.at(-1).children.push(node);
    parents.push(node);
  }

  const list = children => `<ul>${children.map(section => `<li>
    <a data-chapter="${h(section.id)}" href="${path(article.id, section.id)}">${h(section.title || 'Раздел без названия')}</a>
    ${section.children.length ? list(section.children) : ''}
  </li>`).join('')}</ul>`;
  return `<details class="reader-toc">
    <summary>Оглавление</summary>
    <nav aria-label="Оглавление">${list(root.children)}</nav>
  </details>`;
}

function articleReader(article) {
  const next = articles[articles.indexOf(article) + 1];
  return `<article class="reader" data-od-id="article">
    <header class="article-head">
      <h1>${article.titleHtml}</h1>
      ${collapsedToc(article)}
    </header>
    <div class="prose">${article.html}</div>
    ${next ? `<nav class="article-next" aria-label="Дальше по вики">
      <div class="next-arm-rig">
        <img class="next-arm-poster" src="./assets/so101-next.webp" width="768" height="448" alt="" loading="lazy" decoding="async">
        <canvas class="next-arm-canvas" aria-hidden="true"></canvas>
        <a class="next-sign" href="${path(next.id)}">
          <span class="next-label">Следующая статья</span>
          <strong>${h(next.name)}</strong>
          <span class="next-arrow" aria-hidden="true">→</span>
        </a>
      </div>
    </nav>` : ''}
  </article>`;
}

function trackReadingProgress(indicator, article) {
  const events = new AbortController();
  let frame = 0;

  function update() {
    frame = 0;
    const scroller = document.scrollingElement;
    const range = scroller.scrollHeight - scroller.clientHeight;
    indicator.hidden = range <= 0;
    if (range > 0) {
      const progress = Math.max(0, Math.min(1, scroller.scrollTop / range));
      indicator.style.setProperty('--reading-progress', progress.toFixed(5));
    }
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true, signal: events.signal });
  window.addEventListener('resize', scheduleUpdate, { signal: events.signal });
  const observer = new ResizeObserver(scheduleUpdate);
  observer.observe(article);
  scheduleUpdate();

  return () => {
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

function wiki(article, missing) {
  if (article) {
    return `<main id="main" tabindex="-1">${loadWarning()}${articleReader(article)}
      <div class="reading-progress" aria-hidden="true" hidden></div>
    </main>`;
  }
  return `<main id="main" class="wiki-catalog" tabindex="-1">${loadWarning()}${missing || wikiCatalog()}</main>`;
}

function missingArticle() {
  return '<section class="missing"><h1>Статья не найдена</h1><p>Проверь ссылку или вернись к списку статей.</p></section>';
}

function loadWarning() {
  if (!loadError) return '';
  return `<p class="inline-message" role="status">${loadError} <button type="button" class="text-button" data-retry>Повторить загрузку</button></p>`;
}

function normalizeLinks(article) {
  for (const anchor of get('main').querySelectorAll('.article-head h1 a[href], article .prose a[href]')) {
    const target = anchor.getAttribute('href');
    if (target.startsWith('#/')) continue;
    if (!target.startsWith('#') && (!/\.(md|markdown)(#|$)/i.test(target) || /^(\w+:|\/\/)/.test(target))) continue;
    try {
      const [filename, hash = ''] = target.split('#').map(decodeURIComponent);
      const linked = filename ? articles.find(item => item.filename === filename.split('/').at(-1)) : article;
      if (linked) anchor.href = path(linked.id, slug(hash));
    } catch {
      continue;
    }
  }
}

function setCurrentChapter(id) {
  if (activeSection === id) return;
  activeSection = id;
  for (const link of get('page').querySelectorAll('[data-chapter]')) {
    if (id && link.dataset.chapter === id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function scrollToRoute(focus, match) {
  const main = get('main');
  const chapter = route.section && main.querySelector(`#chapter-${CSS.escape(route.section)}`);
  const target = match || chapter;
  if (target) {
    target.scrollIntoView({ block: match ? 'center' : 'start' });
    if (focus) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    setCurrentChapter(route.section);
  } else {
    window.scrollTo(0, 0);
    if (focus) main.focus({ preventScroll: true });
    setCurrentChapter('');
  }
}

function observeChapters() {
  tocObserver?.disconnect();
  const headings = [...get('main').querySelectorAll('[data-heading]')];
  if (!headings.length) return;
  tocObserver = new IntersectionObserver(() => {
    const last = headings.findLast(heading => heading.getBoundingClientRect().top < 112);
    setCurrentChapter(last?.dataset.heading ?? '');
  }, { rootMargin: '-76px 0px -45% 0px' });
  headings.forEach(heading => tocObserver.observe(heading));
}

function render({ focus = false } = {}) {
  route = locationRoute();
  activeSection = '';
  get('page-bar').hidden = !route.id;
  if (!loaded) return;
  const article = articles.find(item => item.id === route.id);
  const missing = route.id && !article ? missingArticle() : '';
  stopRobotTracking?.();
  stopReadingProgress?.();
  stopNextArm?.();
  stopReadingProgress = undefined;
  get('page').innerHTML = wiki(article, missing);
  const search = get('page').querySelector('[data-catalog-search]');
  if (search) bindCatalogSearch(search, articles, path);
  const robot = get('page').querySelector('[data-robot]');
  stopRobotTracking = robot ? trackRobot(robot) : undefined;
  const nextFooter = get('page').querySelector('.article-next');
  stopNextArm = nextFooter ? trackNextArm(nextFooter) : undefined;
  document.title = article?.title ?? (missing ? 'Статья не найдена' : 'Статьи');
  if (article) normalizeLinks(article);
  const match = article && route.query && highlightArticle(get('main'), route.query, route.section);
  scrollToRoute(focus, match);
  if (article) stopReadingProgress = trackReadingProgress(get('main').querySelector('.reading-progress'), get('main').querySelector('.reader'));
  observeChapters();
}

async function loadGuides() {
  try {
    const index = await fetch('./guides/index.json' + guideVersion, { cache: 'no-cache' });
    if (!index.ok) throw new Error('Guide index unavailable');
    const entries = await index.json();
    if (!Array.isArray(entries)) throw new Error('Invalid guide index');
    const filenames = entries.map(entry => typeof entry === 'string' ? entry : entry?.type === 'file' ? entry.name : null)
      .filter(name => typeof name === 'string' && /^[^.].*\.(md|markdown)$/i.test(name) && !/[\/\\\x00]/.test(name))
      .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));
    const files = new Set(filenames);
    const listed = guides.filter(guide => files.delete(guide.filename));
    const records = listed.concat(Array.from(files, filename => ({ id: filename, filename })));
    const results = await Promise.allSettled(records.map(async guide => {
      const response = await fetch('./guides/' + encodeURIComponent(guide.filename) + guideVersion, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Guide unavailable');
      return prepare({ ...guide, markdown: await response.text() });
    }));
    articles = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    loadError = articles.length < records.length ? 'Не удалось загрузить все статьи.' : '';
  } catch {
    articles = [];
    loadError = 'Не удалось открыть список статей.';
  }
  loaded = true;
  render();
}

document.addEventListener('click', event => {
  const retry = event.target.closest('[data-retry]');
  if (retry) {
    retry.disabled = true;
    retry.textContent = 'Загружаю…';
    void loadGuides();
  }
  const link = event.target.closest('a[href]');
  const reader = route.query && event.target.closest('.reader');
  if (reader && window.getSelection()?.isCollapsed !== false) {
    for (const mark of reader.querySelectorAll('mark.search-match')) mark.replaceWith(...mark.childNodes);
    route.query = '';
    history.replaceState(history.state, '', path(route.id, route.section));
  }
  if (!link || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (link.matches('.skip-link')) {
    event.preventDefault();
    get('main').focus();
    return;
  }
  const toc = link.closest('.reader-toc');
  if (toc) toc.open = false;
  if (link.hash && link.hash === location.hash && link.dataset.chapter) {
    event.preventDefault();
    scrollToRoute(true);
  }
});

get('page').addEventListener('keydown', event => {
  const toc = event.target.closest('.reader-toc[open]');
  if (event.key !== 'Escape' || !toc) return;
  event.preventDefault();
  toc.open = false;
  toc.querySelector('summary').focus();
});

window.addEventListener('hashchange', () => {
  const next = locationRoute();
  if (next.id && next.id === route.id && next.query === route.query && next.section !== route.section) {
    route = next;
    scrollToRoute(true);
  } else {
    render({ focus: true });
  }
});

render();
void loadGuides();
