import { guideDataDirectory, nestedGuideImageType } from './guide-images.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function slug(value) {
  return value.normalize('NFKC').toLowerCase().trim()
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
}

const markdown = window.markdownit({ html: false }).use(window.texmath, {
  engine: window.katex,
  delimiters: 'dollars',
  katexOptions: { output: 'htmlAndMathml', trust: false, maxSize: 10 },
});
function nestedGuideImageUrl(url) {
  const relative = url?.replace(/^\.\//, '');
  const path = relative?.split(/[?#]/, 1)[0];
  if (!path?.startsWith(guideDataDirectory + '/')) return;
  try {
    if (nestedGuideImageType(decodeURIComponent(path))) return './guides/' + relative;
  } catch {
    // A malformed URL can be rendered by the default rule without rewriting it.
  }
}

const renderImage = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const image = tokens[index];
  const source = image.attrGet('src');
  const nested = nestedGuideImageUrl(source);
  const filename = /^(?:\.\/)?([^.\/:\\?#][^\/:\\?#]*\.[a-z0-9]+(?:[?#].*)?)$/i.exec(source)?.[1];
  if (nested) {
    image.attrSet('src', nested);
    image.attrJoin('class', 'article-photo');
    image.attrSet('loading', 'lazy');
  } else if (filename) image.attrSet('src', './guides/' + filename);
  return renderImage(tokens, index, options, env, renderer);
};

const renderLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const link = tokens[index];
  const nested = nestedGuideImageUrl(link.attrGet('href'));
  if (nested) link.attrSet('href', nested);
  return renderLinkOpen?.(tokens, index, options, env, renderer)
    ?? renderer.renderToken(tokens, index, options);
};

const keySequence = /<kbd>[^<>\r\n]+<\/kbd>(?:[ \t]*\+[ \t]*<kbd>[^<>\r\n]+<\/kbd>)*/iy;

markdown.inline.ruler.before('html_inline', 'key_sequence', (state, silent) => {
  if (state.src[state.pos] !== '<') return false;
  keySequence.lastIndex = state.pos;
  const match = keySequence.exec(state.src);
  if (!match || keySequence.lastIndex > state.posMax) return false;
  if (!silent) {
    const keys = Array.from(match[0].matchAll(/<kbd>([^<>]+)<\/kbd>/gi), key => key[1]);
    const token = state.push('key_sequence', 'kbd', 0);
    token.content = keys.join(' + ');
    token.meta = keys;
  }
  state.pos = keySequence.lastIndex;
  return true;
});

markdown.renderer.rules.key_sequence = (tokens, index) => {
  const keys = tokens[index].meta.map(key => `<kbd class="keycap">${escapeHtml(key)}</kbd>`);
  return keys.length === 1 ? keys[0] : `<kbd class="key-combo">${keys.join(' + ')}</kbd>`;
};

const noteTypes = new Map([
  ['NOTE', 'На заметку'],
  ['TIP', 'Совет'],
  ['IMPORTANT', 'Важно'],
  ['WARNING', 'Внимание'],
  ['CAUTION', 'Осторожно'],
]);
const codeLanguages = new Map([
  ['bash', ['bash', 'Bash']], ['sh', ['bash', 'Shell']], ['zsh', ['bash', 'Zsh']],
  ['.bashrc', ['bash', '.bashrc']], ['shell', ['bash', 'Shell']],
  ['python', ['python', 'Python']], ['py', ['python', 'Python']],
  ['dockerfile', ['docker', 'Dockerfile']], ['docker', ['docker', 'Dockerfile']],
  ['console-output', ['', 'Вывод терминала']],
]);

const prism = window.Prism;
const shellPrompt = /^[ \t]*(?:[$%]|[\w.-]+@[\w.-]+[ \t]+[^\r\n]+?[ \t]+[$%])[ \t]+/;

function highlightSession(source, grammar) {
  let continued = false;
  return source.split('\n').map(line => {
    const prompt = (continued ? /^[ \t]*>[ \t]+/.exec(line) : shellPrompt.exec(line))?.[0] ?? '';
    const input = prompt || continued;
    const command = line.slice(prompt.length);
    continued = Boolean(input && /(?:^|[^\\])(?:\\\\)*\\$/.test(command));
    if (!input) return escapeHtml(line);

    const marker = prompt ? `<span class="shell-prompt">${escapeHtml(prompt)}</span>` : '';
    return `<span class="shell-input">${marker}${prism.highlight(command, grammar, 'bash')}</span>`;
  }).join('\n');
}

function codeSample(contents, label, variant = '') {
  const caption = label ? `<figcaption>${label}</figcaption>` : '';
  return `<figure class="sample${variant ? ' ' + variant : ''}">${caption}<pre><code>${contents}</code></pre></figure>\n`;
}

markdown.renderer.rules.fence = (tokens, index) => {
  const block = tokens[index];
  const name = block.info.trim().split(/\s+/, 1)[0].toLowerCase();
  if (name === 'man') {
    const contents = block.content.split('\n').map(line => /^[A-Z][A-Z0-9 ]*$/.test(line.trimEnd())
      ? `<span class="manual-heading">${escapeHtml(line)}</span>` : escapeHtml(line)).join('\n');
    return codeSample(contents, 'Справка man', 'sample-manual');
  }
  const [language, label] = codeLanguages.get(name) ?? ['', ''];
  const grammar = language ? prism?.languages[language] : undefined;
  if (grammar && language === 'bash' && shellPrompt.test(block.content.trimStart())) {
    return codeSample(highlightSession(block.content, grammar), label, 'sample-session');
  }
  const contents = grammar ? prism.highlight(block.content, grammar, language) : escapeHtml(block.content);
  return codeSample(contents, label, name === 'console-output' ? 'sample-output' : '');
};

markdown.renderer.rules.code_block = (tokens, index) => (
  codeSample(escapeHtml(tokens[index].content), '')
);

markdown.core.ruler.after('inline', 'guide-notes', ({ tokens }) => {
  const stack = [];
  tokens.forEach((token, index) => {
    if (token.type === 'blockquote_close') {
      if (stack.pop()) token.type = 'guide_note_close';
      return;
    }
    if (token.type !== 'blockquote_open') return;
    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    const first = inline?.children?.[0];
    const match = paragraph?.type === 'paragraph_open' && first?.type === 'text'
      && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i.exec(first.content);
    stack.push(Boolean(match));
    if (!match) return;
    token.type = 'guide_note_open';
    token.meta = noteTypes.get(match[1].toUpperCase());
    first.content = first.content.slice(match[0].length);
    if (!first.content) {
      inline.children.shift();
      if (inline.children[0]?.type === 'softbreak') inline.children.shift();
    }
    if (!inline.children.length) {
      paragraph.type = 'guide_note_empty';
      tokens[index + 3].type = 'guide_note_empty';
    }
  });
});
markdown.renderer.rules.guide_note_open = (tokens, index) =>
  `<aside class="guide-note"><strong>${tokens[index].meta}</strong>`;
markdown.renderer.rules.guide_note_close = () => '</aside>\n';
markdown.renderer.rules.guide_note_empty = () => '';

markdown.core.ruler.after('guide-notes', 'image-captions', ({ tokens, Token }) => {
  tokens.forEach((opening, index) => {
    if (opening.type !== 'paragraph_open') return;
    const children = tokens[index + 1]?.children;
    if (!children?.length) return;

    const [first, second, third] = children;
    const image = children.length === 1 ? first
      : children.length === 3 && first.type === 'link_open' && third.type === 'link_close' ? second
      : null;
    const title = image?.type === 'image' && image.attrGet('title')?.trim();
    if (!title) return;

    const closing = tokens[index + 2];
    opening.tag = closing.tag = 'figure';
    opening.hidden = closing.hidden = false;
    opening.attrJoin('class', 'article-figure');
    image.attrs.splice(image.attrIndex('title'), 1);
    const caption = new Token('text', '', 0);
    caption.content = ' ' + title;
    children.push(new Token('figcaption_open', 'figcaption', 1), caption, new Token('figcaption_close', 'figcaption', -1));
  });
});

const defaultTableOpen = markdown.renderer.rules.table_open;
markdown.renderer.rules.table_open = (tokens, index, options, env, self) =>
  '<div class="table-scroll">' + (defaultTableOpen?.(tokens, index, options, env, self)
    ?? self.renderToken(tokens, index, options));
markdown.renderer.rules.table_close = (tokens, index, options, env, self) =>
  self.renderToken(tokens, index, options) + '</div>';
for (const type of ['td_open', 'th_open']) {
  markdown.renderer.rules[type] = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token.attrs) {
      const alignment = token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1];
      if (alignment) token.attrs = [['class', 'align-' + alignment]];
    }
    return self.renderToken(tokens, index, options);
  };
}

function plain(children = []) {
  return children.map(token => token.children ? plain(token.children)
    : token.type.endsWith('break') ? ' ' : token.content).join('');
}

export function prepare(record) {
  const env = {};
  const tokens = markdown.parse(record.markdown, env);
  const hasTitle = tokens[0]?.type === 'heading_open' && tokens[0].tag === 'h1';
  const fallback = record.filename.replace(/\.(md|markdown)$/i, '');
  const title = hasTitle ? plain(tokens[1].children).trim() || fallback : fallback;
  const titleHtml = hasTitle && plain(tokens[1].children).trim()
    ? markdown.renderer.renderInline(tokens[1].children, markdown.options, env)
    : escapeHtml(title);
  if (hasTitle) tokens.splice(0, 3);

  const topLevel = tokens.some(token => token.type === 'heading_open' && token.level === 0 && token.tag === 'h1');
  const intro = { blocks: [] };
  const sections = [];
  let currentSection = intro;
  const used = new Set();
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open' && token.level === 0) {
      const heading = plain(tokens[index + 1].children);
      const base = slug(heading) || 'раздел';
      let id = base;
      for (let suffix = 2; used.has(id); suffix++) id = base + '-' + suffix;
      used.add(id);
      const level = Math.min(6, Math.max(2, Number(token.tag.slice(1)) + Number(topLevel)));
      token.tag = tokens[index + 2].tag = `h${level}`;
      token.attrSet('id', 'chapter-' + id);
      token.attrSet('data-heading', id);
      currentSection = { id, title: heading, level, blocks: [] };
      sections.push(currentSection);
    } else if (token.type === 'inline' && (token.level !== 1 || tokens[index - 1]?.type !== 'heading_open')) {
      currentSection.blocks.push({ text: plain(token.children) });
    } else if (token.type === 'fence' || token.type === 'code_block') {
      currentSection.blocks.push({ text: token.content, code: true });
    }
  });

  return {
    ...record, title, titleHtml,
    name: record.name ?? title,
    sections,
    searchIntro: intro.blocks,
    html: markdown.renderer.render(tokens, markdown.options, env),
  };
}
