#!/usr/bin/env node
// Static prerender step: fetches events from Sanity (the same public
// read-only GROQ endpoint index.html's client JS already queries) and:
//
//   1. Writes the archive list (title/date/authors for every event)
//      directly into index.html between the SSG:ARCHIVE_LIST markers.
//   2. Writes one static page per event at archive/<slug>/index.html,
//      with that event's title/date/authors/venue and body text
//      prerendered into the raw HTML (and into <title>/<meta description>
//      for SEO/link previews) - the metadata and text search engines
//      actually care about. Images are NOT embedded here; the gallery
//      still loads dynamically via client JS, same as before.
//
// Run it whenever event content changes in Sanity:
//   node build.js
//
// Both steps only ever rewrite content between SSG:* marker comments (or,
// for per-event pages, a fresh copy of index.html) - the hand-written
// index.html template itself is never permanently altered beyond its
// markers, so this is safe to run any time without clobbering edits.

const fs = require('fs');
const path = require('path');

const SANITY_PROJECT_ID = 'jvmgvacm';
const SANITY_DATASET = 'production';
const ROOT_DIR = __dirname;
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');

const MONTH_NAMES_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mirrors L() in index.html: prefer the given locale, fall back to Russian.
function L(localeString, lang) {
  if (!localeString) return '';
  return localeString[lang] || localeString.ru || '';
}

// Mirrors fmtDate() in index.html, Russian-only (this build only
// prerenders the default 'ru' locale - the client re-renders in whatever
// language the visitor has selected as soon as JS runs).
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const monthName = MONTH_NAMES_RU[Number(m) - 1] || m;
  return `${Number(day)} ${monthName} ${y}`;
}

// Mirrors renderSpan() in index.html.
function renderSpan(child, markDefs) {
  let text = escapeHtml(child.text || '').replace(/\n/g, '<br>');
  if (child.marks && child.marks.length) {
    child.marks.forEach((mark) => {
      if (mark === 'strong') text = `<strong>${text}</strong>`;
      else if (mark === 'em') text = `<em>${text}</em>`;
      else if (mark === 'underline') text = `<u>${text}</u>`;
      else {
        const def = (markDefs || []).find((d) => d._key === mark);
        if (def && def._type === 'link' && def.href) {
          const target = def.blank ? ' target="_blank" rel="noopener"' : '';
          text = `<a href="${escapeHtml(def.href)}"${target}>${text}</a>`;
        }
      }
    });
  }
  return text;
}

// Mirrors renderPortableText() in index.html, minus image blocks (images
// stay dynamic/client-loaded, per the "images can load in dynamically"
// scope for this prerender step).
function renderPortableText(blocks) {
  let html = '';
  let listOpen = null;

  const closeList = () => {
    if (listOpen) {
      html += listOpen === 'bullet' ? '</ul>' : '</ol>';
      listOpen = null;
    }
  };

  (blocks || []).forEach((block) => {
    if (block._type === 'image' || block._type === 'divider') {
      // Skipped: media/dividers aren't text content search engines index,
      // and images are intentionally left to load in client-side.
      return;
    }
    if (block._type !== 'block') return;

    const listItem = block.listItem;
    if (listItem) {
      if (listOpen !== listItem) {
        closeList();
        html += listItem === 'bullet' ? '<ul>' : '<ol>';
        listOpen = listItem;
      }
      const inner = (block.children || []).map((c) => renderSpan(c, block.markDefs)).join('');
      html += `<li>${inner}</li>`;
      return;
    }

    closeList();
    const inner = (block.children || []).map((c) => renderSpan(c, block.markDefs)).join('');
    const tag = { h1: 'h1', h2: 'h2', h3: 'h3', blockquote: 'blockquote' }[block.style] || 'p';
    html += `<${tag}>${inner}</${tag}>`;
  });

  closeList();
  return html;
}

function plainTextFromBlocks(blocks) {
  return (blocks || [])
    .filter((b) => b._type === 'block')
    .map((b) => (b.children || []).map((c) => c.text || '').join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mirrors the row template inside renderArchive() in index.html. Keep
// these two in sync if that template changes.
function renderArchiveRow(e, i) {
  const lang = 'ru';
  const authorsArr = (e.authors || []).map((a) => L(a, lang)).filter(Boolean);
  const venueText = L(e.venue, lang);
  const authorsFull = authorsArr.join(', ');
  const authorsShort = authorsArr.length > 3 ? `${authorsArr.slice(0, 3).join(', ')}…` : authorsFull;
  const partsFull = [authorsFull, venueText].filter(Boolean).join(' — ');
  const partsShort = [authorsShort, venueText].filter(Boolean).join(' — ');
  const hasMore = partsFull !== partsShort;
  const href = e.slug ? ` href="/archive/${escapeHtml(e.slug)}"` : ` href="#"`;

  return `
    <a class="archive-item active" data-index="${i}"${href}>
      <div class="gap-spacer-square" data-gap="item-top"><span class="gap-spacer-square-label">1</span></div>
      <div class="archive-item-row">
        <div class="gap-spacer-square" data-gap="item-left"><span class="gap-spacer-square-label">1</span></div>
        <div class="archive-number">${i + 1}</div>
        <div class="gap-spacer-square" data-gap="number-info"><span class="gap-spacer-square-label">1</span></div>
        <div class="archive-info">
          <div class="archive-title">${escapeHtml(L(e.title, lang))}</div>
          <div class="archive-date">${fmtDate(e.date)}</div>
          <div class="archive-authors${hasMore ? ' has-more' : ''}">
            <span class="archive-authors-short">${escapeHtml(partsShort)}</span>
            ${hasMore ? `
              <span class="archive-authors-full">
                <span>${escapeHtml(partsFull)}</span>
                <span>${escapeHtml(partsFull)}</span>
              </span>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="gap-spacer-square" data-gap="item-bottom"><span class="gap-spacer-square-label">1</span></div>
    </a>
  `;
}

// Mirrors the identity row + text body markup inside buildEventDetailHtml()
// in index.html (minus the gallery/switch UI, which stays client-rendered
// - this is just enough structure for the real text to be present in the
// raw HTML for crawlers/link previews; client JS fully replaces it with
// the interactive version once it runs).
function renderEventDetail(e, i) {
  const lang = 'ru';
  const authorsArr = (e.authors || []).map((a) => L(a, lang)).filter(Boolean);
  const venueText = L(e.venue, lang);
  const parts = [authorsArr.join(', '), venueText].filter(Boolean).join(' — ');
  const bodyHtml = renderPortableText((e.text && e.text.ru) || []);
  const additionalHtml = renderPortableText((e.additionalText && e.additionalText.ru) || []);
  const textLabel = L(e.textTitle, lang) || 'Текст';
  const additionalLabel = L(e.additionalTextTitle, lang) || 'Дополнительный текст';
  const galleryNamesHtml = (e.galleryNames || [])
    .map((n) => L(n, lang))
    .filter(Boolean)
    .map((n) => `<div class="content-image-count"><span class="content-gallery-name">${escapeHtml(n)}</span></div>`)
    .join('');

  return `
    <div class="archive-detail-block" data-uid="${i}">
      <div class="archive-detail-header">
        <div class="archive-detail-identity-row">
          <div class="archive-item">
            <div class="archive-title">${escapeHtml(L(e.title, lang))}</div>
            <div class="archive-date">${fmtDate(e.date)}</div>
            <div class="archive-authors">${escapeHtml(parts)}</div>
          </div>
        </div>
      </div>
      ${bodyHtml ? `
        <div class="content-panel-header">${escapeHtml(textLabel)}</div>
        <div class="archive-detail-body">${bodyHtml}</div>
      ` : ''}
      ${additionalHtml ? `
        <div class="content-panel-header">${escapeHtml(additionalLabel)}</div>
        <div class="content-additional-text">${additionalHtml}</div>
      ` : ''}
      ${galleryNamesHtml}
    </div>
  `;
}

function replaceBetweenMarkers(html, markerName, replacement) {
  const startMarker = `<!-- SSG:${markerName}:START -->`;
  const endMarker = `<!-- SSG:${markerName}:END -->`;
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find markers for "${markerName}" in index.html`);
  }
  const before = html.slice(0, start + startMarker.length);
  const after = html.slice(end);
  return before + replacement + after;
}

async function fetchEvents() {
  const query = encodeURIComponent(`*[_type == "event"] | order(date asc){
    title,
    date,
    "slug": slug.current,
    "venue": venue->title,
    "authors": authors[]->name,
    textTitle,
    text{ru[]{ ..., markDefs[]{...} }},
    additionalTextTitle,
    additionalText{ru[]{ ..., markDefs[]{...} }},
    "galleryNames": galleries[].name
  }`);
  const url = `https://${SANITY_PROJECT_ID}.apicdn.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${query}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity fetch failed: ${res.status} ${res.statusText}`);
  const { result } = await res.json();
  return result || [];
}

async function main() {
  console.log('Fetching events from Sanity...');
  const events = await fetchEvents();
  console.log(`Fetched ${events.length} events.`);

  const listHtml = events.length
    ? events.map((e, i) => renderArchiveRow(e, i)).join('')
    : '<div class="archive-empty">No events yet.</div>';
  const loadingHtml = '<div class="archive-loading" id="archiveLoading" style="display: none;">Loading…</div>';

  const baseTemplate = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  // 1. Homepage / archive list.
  let homeHtml = baseTemplate;
  homeHtml = replaceBetweenMarkers(homeHtml, 'ARCHIVE_LIST', listHtml);
  homeHtml = replaceBetweenMarkers(homeHtml, 'LOADING', loadingHtml);
  fs.writeFileSync(INDEX_HTML_PATH, homeHtml);
  console.log('index.html updated with prerendered archive list.');

  // 2. archive/index.html - without this, a static host falls back to a
  // raw directory listing for anyone visiting /archive/ directly instead
  // of picking a specific event (Python's dev server does this too).
  // Shows the archive list as the visible section (matching what the
  // client shows at this route) instead of the landing page's About text.
  let archiveIndexHtml = homeHtml;
  archiveIndexHtml = replaceBetweenMarkers(
    archiveIndexHtml,
    'TITLE',
    '<title>Архив — 139 Documentary Center</title>'
  );
  archiveIndexHtml = replaceBetweenMarkers(
    archiveIndexHtml,
    'DESCRIPTION',
    '<meta name="description" content="Архив событий 139 Documentary Center.">'
  );
  archiveIndexHtml = archiveIndexHtml.replace(
    '<div class="archive" id="archiveView">',
    '<div class="archive visible" id="archiveView">'
  );
  archiveIndexHtml = archiveIndexHtml.replace(
    '<div class="archive-category-label" id="archiveCategoryLabel"></div>',
    '<div class="archive-category-label" id="archiveCategoryLabel">Архив</div>'
  );
  const archiveIndexDir = path.join(ROOT_DIR, 'archive');
  fs.mkdirSync(archiveIndexDir, { recursive: true });
  fs.writeFileSync(path.join(archiveIndexDir, 'index.html'), archiveIndexHtml);
  console.log('Wrote archive/index.html.');

  // 3. One static page per event: archive/<slug>/index.html.
  const archiveDetailPlaceholder =
    '<div class="content-container" id="archiveDetail">\n' +
    '          <div class="archive-detail-placeholder">Select an event to view details.</div>\n' +
    '        </div>';

  let pagesWritten = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e.slug) continue;

    const title = L(e.title, 'ru');
    const description = plainTextFromBlocks((e.text && e.text.ru) || []).slice(0, 160) ||
      `${title} — 139 Documentary Center`;
    const detailHtml = renderEventDetail(e, i);
    const selectedListHtml = listHtml.replace(
      `archive-item active" data-index="${i}"`,
      `archive-item active selected" data-index="${i}"`
    );

    let pageHtml = homeHtml;
    pageHtml = replaceBetweenMarkers(pageHtml, 'ARCHIVE_LIST', selectedListHtml);
    pageHtml = replaceBetweenMarkers(pageHtml, 'TITLE', `<title>${escapeHtml(title)} — 139 Documentary Center</title>`);
    pageHtml = replaceBetweenMarkers(
      pageHtml,
      'DESCRIPTION',
      `<meta name="description" content="${escapeHtml(description)}">`
    );
    pageHtml = pageHtml.replace(
      archiveDetailPlaceholder,
      `<div class="content-container visible" id="archiveDetail">\n          ${detailHtml}\n        </div>`
    );

    const dir = path.join(ROOT_DIR, 'archive', e.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), pageHtml);
    pagesWritten++;
  }

  console.log(`Wrote ${pagesWritten} event pages under archive/<slug>/index.html.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
