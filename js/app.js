/**
 * Browser front end.
 *
 * Holds the parsed songs, re-runs layout when a setting changes, and lets
 * slides be edited before export. Every conversion step lives in the shared
 * modules under `js/`, so this file is only wiring and DOM.
 */

import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.min.mjs';
import { extractLines } from './pdf-text.js';
import { parseSongs } from './song-parser.js';
import { normalizeSong } from './lyrics.js';
import { layoutSong } from './reflow.js';
import { buildPresentation, proFileName, groupColor } from './propresenter.js';
import { songToText, textFileName } from './plaintext.js';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.worker.min.mjs';

const el = (id) => document.getElementById(id);

const dom = {
  drop: el('drop'), file: el('file'), browse: el('browse'), status: el('status'),
  results: el('results'), songs: el('songs'), warnings: el('warnings'),
  maxLines: el('maxLines'), maxChars: el('maxChars'),
  rejoinHyphens: el('rejoinHyphens'), straightQuotes: el('straightQuotes'),
  fontFamily: el('fontFamily'), fontSize: el('fontSize'), slideSize: el('slideSize'),
  downloadAll: el('downloadAll'), reset: el('reset'),
};

/** Parsed songs straight from the PDF, before normalisation or layout. */
let parsed = [];
/** Songs as currently laid out and possibly hand-edited. */
let songs = [];
/** Set once a slide has been edited, so settings changes can warn first. */
let edited = false;
let sourceName = 'songs';

// ── settings ─────────────────────────────────────────────────────────────────

function readSettings() {
  const [width, height] = dom.slideSize.value.split('x').map(Number);
  return {
    maxLines: clamp(Number(dom.maxLines.value), 1, 6),
    maxChars: clamp(Number(dom.maxChars.value), 16, 90),
    rejoinHyphens: dom.rejoinHyphens.checked,
    straightQuotes: dom.straightQuotes.checked,
    fontFamily: dom.fontFamily.value.trim() || 'Arial',
    fontSize: clamp(Number(dom.fontSize.value), 12, 200),
    slideSize: { width, height },
  };
}

const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

// ── loading ──────────────────────────────────────────────────────────────────

async function loadPdf(file) {
  if (!file) return;
  sourceName = file.name.replace(/\.pdf$/i, '') || 'songs';
  setStatus(`Reading ${file.name}…`);
  dom.drop.classList.add('busy');

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const lines = await extractLines(doc);
    parsed = parseSongs(lines);
    edited = false;

    if (!parsed.length || parsed.every((s) => s.groups.length === 0)) {
      setStatus('No lyrics found in that PDF. Is it a scanned image rather than text?', true);
      dom.results.hidden = true;
      return;
    }

    relayout();
    dom.results.hidden = false;
    const slides = songs.reduce((n, s) => n + countSlides(s), 0);
    setStatus(`${parsed.length} song${parsed.length === 1 ? '' : 's'}, ${slides} slides. Edit any slide before downloading.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not read that PDF: ${error.message}`, true);
    dom.results.hidden = true;
  } finally {
    dom.drop.classList.remove('busy');
  }
}

/** Re-run normalisation and layout from the parsed source, discarding edits. */
function relayout() {
  const options = readSettings();
  songs = parsed
    .map((song) => normalizeSong(song, options))
    .map((song) => layoutSong(song, options));
  edited = false;
  render();
}

const countSlides = (song) => song.groups.reduce((n, g) => n + g.slides.length, 0);

// ── rendering ────────────────────────────────────────────────────────────────

function render() {
  renderWarnings();
  dom.songs.replaceChildren(...songs.map(renderSong));
}

function renderWarnings() {
  const items = [];
  for (const song of songs) {
    for (const warning of song.warnings) items.push(`${song.title}: ${warning}`);
    const joins = [...new Set(song.hyphenJoins ?? [])];
    if (joins.length) items.push(`${song.title}: rejoined ${joins.join(', ')}`);
  }
  if (!items.length) {
    dom.warnings.hidden = true;
    return;
  }
  dom.warnings.hidden = false;
  const list = document.createElement('ul');
  list.append(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  const heading = document.createElement('h3');
  heading.textContent = 'Worth a look';
  dom.warnings.replaceChildren(heading, list);
}

function renderSong(song, songIndex) {
  const node = document.createElement('article');
  node.className = 'song';

  const head = document.createElement('div');
  head.className = 'song-head';

  const title = document.createElement('h2');
  title.className = 'song-title';
  title.textContent = song.title;
  if (song.key) {
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = song.note ? `${song.key} · ${song.note}` : song.key;
    title.append(key);
  }

  const meta = document.createElement('span');
  meta.className = 'song-meta';
  meta.textContent = `${song.groups.length} sections · ${countSlides(song)} slides`;

  const actions = document.createElement('div');
  actions.className = 'song-actions';
  actions.append(
    button('Download .pro', 'small', () => downloadPro(song)),
    button('.txt', 'small', () => downloadText(song)),
  );

  head.append(title, meta, actions);
  node.append(head);

  if (song.arrangement.length) {
    const arrangement = document.createElement('div');
    arrangement.className = 'arrangement';
    const label = document.createElement('span');
    label.textContent = 'Arrangement:';
    arrangement.append(label);
    for (const name of song.arrangement) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.setProperty('--group', cssColor(groupColor(name)));
      chip.textContent = name;
      arrangement.append(chip);
    }
    node.append(arrangement);
  }

  song.groups.forEach((group, groupIndex) => {
    node.append(renderGroup(group, songIndex, groupIndex));
  });
  return node;
}

function renderGroup(group, songIndex, groupIndex) {
  const node = document.createElement('section');
  node.className = 'group';
  node.style.setProperty('--group', cssColor(groupColor(group.name)));

  const head = document.createElement('div');
  head.className = 'group-head';
  const swatch = document.createElement('span');
  swatch.className = 'group-swatch';
  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = group.name;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = `${group.slides.length} slide${group.slides.length === 1 ? '' : 's'}`;
  head.append(swatch, name, count);

  const slides = document.createElement('div');
  slides.className = 'slides';
  group.slides.forEach((lines, slideIndex) => {
    slides.append(renderSlide(lines, songIndex, groupIndex, slideIndex));
  });

  node.append(head, slides);
  return node;
}

function renderSlide(lines, songIndex, groupIndex, slideIndex) {
  const node = document.createElement('div');
  node.className = 'slide';

  const index = document.createElement('span');
  index.className = 'slide-index';
  index.textContent = slideIndex + 1;

  const area = document.createElement('textarea');
  area.value = lines.join('\n');
  area.rows = Math.max(2, lines.length);
  area.spellcheck = false;
  area.setAttribute('aria-label', `Slide ${slideIndex + 1}`);
  area.addEventListener('input', () => {
    songs[songIndex].groups[groupIndex].slides[slideIndex] =
      area.value.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    edited = true;
  });

  node.append(index, area);
  return node;
}

function button(label, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

const cssColor = (c) =>
  `rgb(${Math.round(c.red * 255)} ${Math.round(c.green * 255)} ${Math.round(c.blue * 255)})`;

// ── downloads ────────────────────────────────────────────────────────────────

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPro(song) {
  const bytes = buildPresentation(song, readSettings());
  saveBlob(new Blob([bytes], { type: 'application/octet-stream' }), proFileName(song));
}

function downloadText(song) {
  saveBlob(new Blob([songToText(song)], { type: 'text/plain' }), textFileName(song));
}

async function downloadAll() {
  if (songs.length === 1) {
    downloadPro(songs[0]);
    return;
  }
  if (typeof JSZip === 'undefined') {
    setStatus('The zip library did not load; download songs individually.', true);
    return;
  }
  const options = readSettings();
  const zip = new JSZip();
  for (const song of songs) {
    zip.file(proFileName(song), buildPresentation(song, options));
    zip.file(`text/${textFileName(song)}`, songToText(song));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, `${sourceName}.zip`);
}

// ── events ───────────────────────────────────────────────────────────────────

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle('error', isError);
}

function onSettingChanged() {
  if (!parsed.length) return;
  if (edited && !confirm('Re-splitting the slides will discard your edits. Continue?')) {
    return;
  }
  relayout();
}

dom.browse.addEventListener('click', (event) => {
  event.stopPropagation();
  dom.file.click();
});
dom.drop.addEventListener('click', () => dom.file.click());
dom.drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    dom.file.click();
  }
});
dom.file.addEventListener('change', () => loadPdf(dom.file.files[0]));

for (const type of ['dragenter', 'dragover']) {
  dom.drop.addEventListener(type, (event) => {
    event.preventDefault();
    dom.drop.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  dom.drop.addEventListener(type, () => dom.drop.classList.remove('dragging'));
}
dom.drop.addEventListener('drop', (event) => {
  event.preventDefault();
  loadPdf(event.dataTransfer?.files?.[0]);
});

// Layout settings re-split the slides; styling settings only affect export.
for (const control of [dom.maxLines, dom.maxChars, dom.rejoinHyphens, dom.straightQuotes]) {
  control.addEventListener('change', onSettingChanged);
}

dom.downloadAll.addEventListener('click', downloadAll);
dom.reset.addEventListener('click', () => {
  parsed = [];
  songs = [];
  edited = false;
  dom.file.value = '';
  dom.results.hidden = true;
  setStatus('');
});
