/**
 * Browser front end.
 *
 * Holds the parsed songs, re-runs layout when a setting changes, and lets
 * slides be edited before export. Every conversion step lives in the shared
 * modules under `js/`, so this file is only wiring and DOM.
 */

import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.min.mjs';
import { extractLines } from './pdf-text.js';
import { linesFromText } from './text-input.js';
import { parseSongs } from './song-parser.js';
import { normalizeSong } from './lyrics.js';
import { layoutSong } from './reflow.js';
import { groupColor } from './propresenter.js';
import { toFiles } from './pipeline.js';
import { songToText } from './plaintext.js';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.worker.min.mjs';

const el = (id) => document.getElementById(id);

const dom = {
  drop: el('drop'), file: el('file'), browse: el('browse'), status: el('status'),
  tabPdf: el('tabPdf'), tabPaste: el('tabPaste'),
  panelPdf: el('panelPdf'), panelPaste: el('panelPaste'),
  paste: el('paste'), convert: el('convert'), pasteSample: el('pasteSample'),
  copyAll: el('copyAll'),
  results: el('results'), songs: el('songs'), warnings: el('warnings'),
  maxLines: el('maxLines'), maxChars: el('maxChars'),
  rejoinHyphens: el('rejoinHyphens'), straightQuotes: el('straightQuotes'),
  fontFamily: el('fontFamily'), fontSize: el('fontSize'), slideSize: el('slideSize'),
  downloadAll: el('downloadAll'), reset: el('reset'),
};

/** Parsed songs straight from the input, before normalisation or layout. */
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
    announceLoaded();
  } catch (error) {
    console.error(error);
    setStatus(`Could not read that PDF: ${error.message}`, true);
    dom.results.hidden = true;
  } finally {
    dom.drop.classList.remove('busy');
  }
}

/**
 * Parse pasted lyrics.
 *
 * Structure comes from the text itself - chord lines, "[Verse 1]" headings and
 * "1. Title (Key)" numbering - so copying everything out of a PDF viewer and
 * pasting it here gives the same slides as opening the PDF.
 */
function loadPastedText() {
  const text = dom.paste.value;
  if (text.trim() === '') {
    setStatus('Paste some lyrics first.', true);
    return;
  }
  try {
    parsed = parseSongs(linesFromText(text));
    edited = false;

    if (!parsed.length || parsed.every((s) => s.groups.length === 0)) {
      setStatus('No lyrics found in that text — every line looked like a chord or a direction.', true);
      dom.results.hidden = true;
      return;
    }

    relayout();
    sourceName = parsed[0].title || 'songs';
    dom.results.hidden = false;
    announceLoaded();
  } catch (error) {
    console.error(error);
    setStatus(`Could not parse that text: ${error.message}`, true);
    dom.results.hidden = true;
  }
}

/** Report what was found, once songs are laid out. */
function announceLoaded() {
  const slides = songs.reduce((n, s) => n + countSlides(s), 0);
  const count = `${songs.length} song${songs.length === 1 ? '' : 's'}, ${slides} slides`;
  setStatus(`${count}. Edit any slide, then copy or download.`);
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

/** Slides that would actually be exported: an emptied one is not one. */
const countGroupSlides = (group) =>
  group.slides.filter((slide) => slide.some((line) => line.trim() !== '')).length;

const countSlides = (song) => song.groups.reduce((n, g) => n + countGroupSlides(g), 0);

// ── rendering ────────────────────────────────────────────────────────────────

function render() {
  renderWarnings();
  dom.songs.replaceChildren(...songs.map(renderSong));
  dom.downloadAll.textContent =
    songs.length === 1 ? 'Download .pro' : 'Download all as .zip';
  dom.copyAll.textContent = songs.length === 1 ? 'Copy as text' : 'Copy all as text';
}

/**
 * Refresh the slide tallies after an edit.
 *
 * An emptied slide is dropped at export - projecting a blank is never what
 * someone clearing a box meant - so the counts have to stop including it.
 */
function updateCounts() {
  for (const [songIndex, song] of songs.entries()) {
    const node = dom.songs.children[songIndex];
    if (!node) continue;
    const meta = node.querySelector('.song-meta');
    if (meta) meta.textContent = `${song.groups.length} sections · ${countSlides(song)} slides`;
    node.querySelectorAll('.group').forEach((groupNode, groupIndex) => {
      const count = groupNode.querySelector('.group-count');
      const n = countGroupSlides(song.groups[groupIndex]);
      if (count) count.textContent = `${n} slide${n === 1 ? '' : 's'}`;
    });
  }
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
  const copy = button('Copy text', 'small copy', () => copySong(songIndex, copy));
  actions.append(
    copy,
    button('.pro', 'small', () => downloadPro(songIndex)),
    button('.txt', 'small', () => downloadText(songIndex)),
  );

  head.append(title, meta, actions);
  node.append(head, renderTextPreview(songIndex));

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

/**
 * A collapsed view of exactly what "Copy text" puts on the clipboard.
 *
 * Filled when opened rather than up front, so it always reflects the current
 * edits, and so a song with no-one looking at it costs nothing to render. It
 * also doubles as the fallback when the clipboard is unavailable: the text is
 * on the page, selectable by hand.
 */
function renderTextPreview(songIndex) {
  const node = document.createElement('details');
  node.className = 'text-preview';

  const summary = document.createElement('summary');
  summary.textContent = 'Show the text';

  const area = document.createElement('textarea');
  area.className = 'preview-box';
  area.readOnly = true;
  area.spellcheck = false;
  area.setAttribute('aria-label', 'Import-ready text');

  node.addEventListener('toggle', () => {
    if (!node.open) return;
    area.value = songToText(songs[songIndex]);
    area.rows = Math.min(24, area.value.split('\n').length + 1);
  });

  node.append(summary, area);
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
    const group = songs[songIndex].groups[groupIndex];
    group.slides[slideIndex] = area.value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    edited = true;
    node.classList.toggle('empty', group.slides[slideIndex].length === 0);
    updateCounts();
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

// ── clipboard ────────────────────────────────────────────────────────────────

/**
 * Copy text, telling the user which way it went.
 *
 * `navigator.clipboard` needs a secure context and can still be refused by
 * permissions policy, so a failure is expected rather than exceptional: the
 * preview panel below the song holds the same text, and the message points at
 * it instead of leaving the button looking broken.
 */
async function copyToClipboard(text, trigger) {
  try {
    await navigator.clipboard.writeText(text);
    flash(trigger, 'Copied');
    return true;
  } catch (error) {
    console.error(error);
    setStatus('Could not reach the clipboard. Open "Show the text" and copy it by hand.', true);
    return false;
  }
}

/** Briefly swap a button's label to confirm the click did something. */
function flash(node, label) {
  if (!node) return;
  const original = node.dataset.label ?? node.textContent;
  node.dataset.label = original;
  node.textContent = label;
  node.classList.add('done');
  clearTimeout(Number(node.dataset.timer));
  node.dataset.timer = String(setTimeout(() => {
    node.textContent = node.dataset.label ?? original;
    node.classList.remove('done');
  }, 1400));
}

const copySong = (index, trigger) => copyToClipboard(songToText(songs[index]), trigger);

/**
 * Copy every song as one block.
 *
 * Songs are separated by their title on its own line so the boundary is
 * obvious after pasting; a single song is copied bare, with nothing to
 * delete before importing.
 */
function copyAllSongs(trigger) {
  const text =
    songs.length === 1
      ? songToText(songs[0])
      : songs.map((song) => `${titleLine(song)}\n\n${songToText(song)}`).join('\n');
  return copyToClipboard(text, trigger);
}

const titleLine = (song) => (song.key ? `${song.title} (${song.key})` : song.title);

// ── downloads ────────────────────────────────────────────────────────────────

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render the current songs, sharing one de-duplicated set of filenames. */
const renderFiles = () => toFiles(songs, readSettings());

function downloadPro(index) {
  const { pro } = renderFiles()[index];
  saveBlob(new Blob([pro.bytes], { type: 'application/octet-stream' }), pro.name);
}

function downloadText(index) {
  const { text } = renderFiles()[index];
  saveBlob(new Blob([text.text], { type: 'text/plain' }), text.name);
}

async function downloadAll() {
  // One song still goes out as a plain .pro - a zip holding a single file is
  // just an extra step - and the button says so.
  if (songs.length === 1) {
    downloadPro(0);
    return;
  }
  if (typeof JSZip === 'undefined') {
    setStatus('The zip library did not load; download songs individually.', true);
    return;
  }
  const zip = new JSZip();
  for (const { pro, text } of renderFiles()) {
    zip.file(pro.name, pro.bytes);
    zip.file(`text/${text.name}`, text.text);
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
dom.copyAll.addEventListener('click', () => copyAllSongs(dom.copyAll));
dom.reset.addEventListener('click', () => {
  parsed = [];
  songs = [];
  edited = false;
  dom.file.value = '';
  dom.paste.value = '';
  dom.results.hidden = true;
  setStatus('');
});

// ── input mode ───────────────────────────────────────────────────────────────

/** Switch between the file and paste inputs. Parsed songs are left alone. */
function showTab(which) {
  const paste = which === 'paste';
  dom.tabPaste.setAttribute('aria-selected', String(paste));
  dom.tabPdf.setAttribute('aria-selected', String(!paste));
  dom.panelPaste.hidden = !paste;
  dom.panelPdf.hidden = paste;
  if (paste) dom.paste.focus();
}

dom.tabPdf.addEventListener('click', () => showTab('pdf'));
dom.tabPaste.addEventListener('click', () => showTab('paste'));
dom.convert.addEventListener('click', loadPastedText);

// Ctrl/Cmd+Enter converts without reaching for the mouse.
dom.paste.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    loadPastedText();
  }
});

/** A short worked example, so the expected shape is obvious at a glance. */
const SAMPLE = [
  '1. Yours Alone (G)',
  '4/4 170 BPM',
  '[Verse 1]',
  'C                 G',
  'Oh, what a love is this',
  'C                   D',
  'That rescues and for-gives?',
  'Em                C',
  'You suffered in our place',
  'D',
  'To make us heirs of grace',
  '[Chorus 1]',
  'G',
  'We are Yours alone',
  'G           Em            D',
  'Our life, our everything is Yours alone',
  'G/B',
  'Oh, King of mercy',
  'C          Em',
  'Make our hearts Your throne',
].join('\n');

dom.pasteSample.addEventListener('click', () => {
  dom.paste.value = SAMPLE;
  loadPastedText();
});
