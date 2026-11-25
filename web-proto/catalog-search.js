import { escapeHtml as h } from './markdown.js';

const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const send = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18V6m-5 5 5-5 5 5"/></svg>';

export function catalogSearch() {
  return `<section class="catalog-chat" id="catalog-chat" aria-labelledby="catalog-chat-title" hidden>
    <header class="catalog-chat-header">
      <h2 id="catalog-chat-title">Поиск по статьям</h2>
      <button class="catalog-chat-close" type="button" aria-label="Закрыть чат">${cross}</button>
    </header>
    <div class="catalog-chat-log" role="log" aria-label="Переписка с роботом" tabindex="0">
      <p class="catalog-chat-reply"><span class="sr-only">Бот. </span>Что ищем?</p>
    </div>
    <form class="catalog-search">
      <label class="sr-only" for="catalog-query">Поиск по статьям</label>
      <div class="catalog-search-field">
        <input id="catalog-query" type="search" placeholder="Тема или команда" enterkeyhint="send" autocomplete="off">
        <button class="catalog-chat-send" type="submit" aria-label="Отправить запрос" disabled>${send}</button>
      </div>
    </form>
  </section>`;
}

const compact = text => text.replace(/\s+/g, ' ').trim();
const fold = text => text.toLowerCase().replaceAll('ё', 'е');

const sentenceSegmenter = Intl.Segmenter && new Intl.Segmenter('ru', { granularity: 'sentence' });

function replyFragments(blocks, query) {
  const words = query.split(' ');
  const fragments = blocks.flatMap(({ text, code }) => {
    const pieces = code ? text.split('\n')
      : sentenceSegmenter ? Array.from(sentenceSegmenter.segment(text), piece => piece.segment)
      : [text];
    return pieces.map(piece => ({ text: code ? piece.trim() : compact(piece), code }));
  }).filter(fragment => fragment.text);
  if (!fragments.length) return [];

  let best = 0;
  let topScore = -1;
  for (const [position, fragment] of fragments.entries()) {
    const text = fold(compact(fragment.text));
    const score = text.includes(query) ? words.length + 1 : words.filter(word => text.includes(word)).length;
    if (score > topScore) {
      best = position;
      topScore = score;
    }
  }

  const { text, code } = fragments[best];
  const previous = fragments[best - 1];
  const context = code && previous && !previous.code && previous.text.endsWith(':') && previous.text.length <= 160;
  const normalized = fold(text);
  const exact = normalized.indexOf(query);
  const firstWord = words.map(word => normalized.indexOf(word)).filter(index => index >= 0);
  const hit = exact >= 0 ? exact : firstWord.length ? Math.min(...firstWord) : 0;
  const start = text.length > 160 ? Math.max(0, hit - 25) : 0;
  const end = start + 160;
  const excerpt = (start ? '…' : '') + text.slice(start, end).trimEnd() + (end < text.length ? '…' : '');
  return [...(context ? [previous] : []), { text: excerpt, code }];
}

function searchArticles(index, query) {
  const words = query.split(' ');
  const includesWords = text => words.every(word => text.includes(word));
  return index.flatMap(({ article, title, sections }) => {
    if (includesWords(title)) return [{ article, score: title.includes(query) ? 5 : 4 }];
    let best;
    for (const section of sections) {
      const searchable = `${title} ${section.heading} ${section.normalized}`;
      if (!includesWords(searchable)) continue;
      const score = includesWords(section.heading) ? 3 : section.normalized.includes(query) ? 2 : 1;
      if (!best || score > best.score) best = { article, section, score };
    }
    return best ? [best] : [];
  }).sort((a, b) => b.score - a.score);
}

export function bindCatalogSearch(search, articles, path) {
  const trigger = search.querySelector('.robot-trigger');
  const chat = search.querySelector('.catalog-chat');
  const log = chat.querySelector('.catalog-chat-log');
  const form = chat.querySelector('form');
  const input = form.querySelector('input');
  const submit = form.querySelector('.catalog-chat-send');
  const index = articles.map(article => ({
    article,
    title: fold(compact(`${article.name} ${article.title}`)),
    sections: [{ id: '', title: '', blocks: article.searchIntro }, ...article.sections].map(section => ({
      ...section,
      normalized: fold(compact(section.blocks.map(block => block.text).join(' '))),
      heading: fold(compact(section.title)),
    })),
  }));

  function setOpen(open) {
    chat.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    (open ? input : trigger).focus();
  }

  trigger.addEventListener('click', () => setOpen(chat.hidden));
  chat.querySelector('.catalog-chat-close').addEventListener('click', () => setOpen(false));
  chat.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setOpen(false);
  });

  input.addEventListener('input', () => {
    submit.disabled = !compact(input.value);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const question = compact(input.value);
    if (!question) return;

    const query = fold(question);
    const matches = searchArticles(index, query);
    const reply = matches.length ? `<ul class="catalog-search-list" role="list">${matches.map(({ article, section }) => {
      const blocks = section?.blocks.length ? section.blocks : article.searchIntro;
      const excerpt = replyFragments(blocks, query).map(({ text, code }) => code
        ? `<code>${h(text)}</code>`
        : `<span>${h(text)}</span>`).join('');
      return `<li><a href="${h(path(article.id, section?.id, question))}">
        ${excerpt ? `<span class="catalog-search-snippet">${excerpt}</span>` : ''}
        <strong>${h(article.name)}</strong>
        ${section?.title ? `<span class="catalog-search-chapter">${h(section.title)}</span>` : ''}
      </a></li>`;
    }).join('')}</ul>` : '<p>Не нашёл. Попробуй название темы или команду.</p>';

    const exchange = document.createElement('div');
    exchange.className = 'catalog-chat-exchange';
    exchange.innerHTML = `
      <p class="catalog-chat-question"><span class="sr-only">Ты. </span>${h(question)}</p>
      <div class="catalog-chat-reply"><span class="sr-only">Бот. </span>${reply}</div>`;
    log.append(exchange);
    log.scrollTop = exchange.offsetTop;

    input.value = '';
    submit.disabled = true;
    input.focus({ preventScroll: true });
  });
}

const textBlock = 'p, pre, figcaption, li, dt, dd, th, td, h1, h2, h3, h4, h5, h6';

export function highlightArticle(main, query, preferredSection) {
  query = fold(compact(query));
  if (!query) return null;

  const terms = query.split(' ');
  const words = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const literal = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('е', '[её]');
  const alternatives = words.map(literal);
  if (terms.length > 1) alternatives.unshift(terms.map(literal).join('\\s+'));
  const expression = new RegExp(alternatives.join('|'), 'giu');
  const changes = [];
  let primary = [];
  let primaryScore = -1;
  let hasExactMatch = false;
  let section = '';

  for (const root of main.querySelectorAll('.article-head h1, .prose')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current;
    let text = '';
    let nodes = [];

    function collectMatches() {
      if (current?.hasAttribute('data-heading')) section = current.dataset.heading;
      let firstNode = 0;
      for (const match of text.matchAll(expression)) {
        const end = match.index + match[0].length;
        const exact = fold(compact(match[0])) === query;
        hasExactMatch ||= exact;
        while (nodes[firstNode].end <= match.index) firstNode++;
        const marks = [];
        for (let index = firstNode; index < nodes.length && nodes[index].start < end; index++) {
          const { node, start, end: nodeEnd } = nodes[index];
          const from = Math.max(match.index, start) - start;
          const to = Math.min(end, nodeEnd) - start;
          if (to <= from) continue;
          const mark = document.createElement('mark');
          mark.className = 'search-match';
          marks.push(mark);
          changes.push({ node, from, to, mark, exact, section });
        }
        marks[0].classList.add('search-match-start');
        marks.at(-1).classList.add('search-match-end');
        const score = Number(exact);
        if ((!preferredSection || section === preferredSection) && score > primaryScore) {
          primary = marks;
          primaryScore = score;
        }
      }
      text = '';
      nodes = [];
    }

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.length || node.parentElement.closest('.sample figcaption, [hidden]')) continue;
      const block = node.parentElement.closest(textBlock) ?? root;
      if (block !== current) {
        collectMatches();
        current = block;
      }
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
    }
    collectMatches();
  }

  // Apply from the end so offsets still refer to the original part of each text node.
  for (const { node, from, to, mark, exact, section } of changes.reverse()) {
    if (hasExactMatch && !exact && (primaryScore === 1 || section !== preferredSection)) continue;
    const matched = from ? node.splitText(from) : node;
    if (to - from < matched.length) matched.splitText(to - from);
    matched.replaceWith(mark);
    mark.append(matched);
  }
  for (const mark of primary) mark.classList.add('search-match-primary');
  return primary[0] ?? null;
}
