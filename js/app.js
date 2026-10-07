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
import { layoutSong, toSlides } from './reflow.js';
import { groupColor } from './propresenter.js';
import { toFiles } from './pipeline.js';
import { songToText, parseSongText } from './plaintext.js';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.worker.min.mjs';

const el = (id) => document.getElementById(id);

const dom = {
  drop: el('drop'), file: el('file'), browse: el('browse'), status: el('status'),
  tabPdf: el('tabPdf'), tabPaste: el('tabPaste'),
  panelPdf: el('panelPdf'), panelPaste: el('panelPaste'),
  paste: el('paste'), convert: el('convert'), pasteSample: el('pasteSample'),
  copyAll: el('copyAll'),
  exportWhat: el('exportWhat'), exportDetail: el('exportDetail'),
  results: el('results'), songs: el('songs'), warnings: el('warnings'),
  songTabs: el('songTabs'),
  maxLines: el('maxLines'), maxChars: el('maxChars'),
  rejoinHyphens: el('rejoinHyphens'), straightQuotes: el('straightQuotes'),
  dropTrailingCommas: el('dropTrailingCommas'),
  blankFirstSlide: el('blankFirstSlide'),
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

// ── editor view state ────────────────────────────────────────────────────────
// All of this is *how the editor is being looked at*, not part of a song, so
// none of it is exported. It is keyed by index and therefore only meaningful
// for the songs currently loaded; `relayout` and "Start over" clear it.

/** The song shown on its own, or null for all of them. */
let activeSong = null;
/** Song indices whose body is folded away. */
const collapsedSongs = new Set();
/** "songIndex:groupIndex" for each folded section. */
const collapsedGroups = new Set();
/** Song indices being edited as text rather than as cards. */
const textMode = new Set();
/** The slide currently being dragged, or null. */
let dragging = null;

/** Forget every collapse, tab and mode - the songs they referred to are gone. */
function resetView() {
  activeSong = null;
  collapsedSongs.clear();
  collapsedGroups.clear();
  textMode.clear();
  dragging = null;
}

// ── settings ─────────────────────────────────────────────────────────────────

function readSettings() {
  const [width, height] = dom.slideSize.value.split('x').map(Number);
  return {
    maxLines: clamp(Number(dom.maxLines.value), 1, 6),
    maxChars: clamp(Number(dom.maxChars.value), 16, 90),
    rejoinHyphens: dom.rejoinHyphens.checked,
    straightQuotes: dom.straightQuotes.checked,
    dropTrailingCommas: dom.dropTrailingCommas.checked,
    blankFirstSlide: dom.blankFirstSlide.checked,
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
  resetView();
  render();
}

/**
 * Slides that would actually be exported: an emptied one is not one.
 *
 * The leading blank section is the exception - its slide is empty on purpose
 * and is written out - so it counts every slide it has.
 */
const countGroupSlides = (group) =>
  group.blank
    ? group.slides.length
    : group.slides.filter((slide) => slide.some((line) => line.trim() !== '')).length;

const countSlides = (song) => song.groups.reduce((n, g) => n + countGroupSlides(g), 0);

// ── rendering ────────────────────────────────────────────────────────────────

function render() {
  renderWarnings();
  renderSongTabs();
  dom.songs.replaceChildren(...songs.map(renderSong));
  updateExport();
}

/**
 * A tab per song, plus "All songs".
 *
 * A six-song set sheet is a very long page, and every song looks alike from a
 * distance. Narrowing to one at a time is the difference between editing and
 * scrolling. One song needs no tabs, so it gets none.
 */
function renderSongTabs() {
  if (songs.length < 2) {
    dom.songTabs.hidden = true;
    dom.songTabs.replaceChildren();
    return;
  }
  dom.songTabs.hidden = false;

  const tab = (label, index) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'song-tab';
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(activeSong === index));
    node.textContent = label;
    node.addEventListener('click', () => {
      activeSong = index;
      render();
    });
    return node;
  };

  dom.songTabs.replaceChildren(
    tab('All songs', null),
    ...songs.map((song, i) => tab(song.title || `Song ${i + 1}`, i)),
  );
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
  updateExport();
}

/**
 * Keep the export bar describing what the buttons would actually produce.
 *
 * Called after every edit, insertion and removal, so the count in the bar is
 * the count in the file - including slides that were emptied and will be
 * dropped, and sections that were emptied and will go with them.
 */
function updateExport() {
  const slides = songs.reduce((n, song) => n + countSlides(song), 0);
  const sections = songs.reduce(
    (n, song) => n + song.groups.filter((g) => countGroupSlides(g) > 0).length,
    0,
  );
  const one = songs.length === 1;

  dom.exportWhat.textContent = one
    ? songs[0].title || 'Untitled'
    : `${songs.length} songs`;
  dom.exportDetail.textContent =
    `${sections} section${sections === 1 ? '' : 's'} · ` +
    `${slides} slide${slides === 1 ? '' : 's'}`;

  dom.downloadAll.textContent = one
    ? 'Download ProPresenter file'
    : `Download ${songs.length} ProPresenter files (.zip)`;
  dom.copyAll.textContent = one ? 'Copy as text' : 'Copy all as text';
  dom.downloadAll.disabled = slides === 0;
  dom.copyAll.disabled = slides === 0;
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
  // Tabs narrow the page to one song; the rest stay rendered so their edits,
  // and the indices every handler closes over, survive the switch.
  node.hidden = activeSong !== null && activeSong !== songIndex;

  const collapsed = collapsedSongs.has(songIndex);
  const asText = textMode.has(songIndex);
  node.classList.toggle('collapsed', collapsed);

  const head = document.createElement('div');
  head.className = 'song-head';

  const toggle = disclosure(!collapsed, `${collapsed ? 'Expand' : 'Collapse'} ${song.title}`, () => {
    flip(collapsedSongs, songIndex);
    refreshSong(songIndex);
  });

  const title = document.createElement('h2');
  title.className = 'song-title';
  title.textContent = song.title;
  if (song.key) {
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = song.note ? `${song.key} · ${song.note}` : song.key;
    title.append(key);
  }
  // The heading is the biggest target on the card, so it folds too. The button
  // beside it is what carries the state for a screen reader.
  title.addEventListener('click', () => toggle.click());

  const meta = document.createElement('span');
  meta.className = 'song-meta';
  meta.textContent = `${song.groups.length} sections · ${countSlides(song)} slides`;

  const modes = document.createElement('div');
  modes.className = 'song-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'How to edit this song');
  modes.append(
    modeButton('Slides', !asText, () => setTextMode(songIndex, false)),
    modeButton('Text', asText, () => setTextMode(songIndex, true)),
  );

  const actions = document.createElement('div');
  actions.className = 'song-actions';
  const copy = button('Copy text', 'small copy', () => copySong(songIndex, copy));
  actions.append(
    copy,
    button('.pro', 'small', () => downloadPro(songIndex)),
    button('.txt', 'small', () => downloadText(songIndex)),
  );

  const headLeft = document.createElement('div');
  headLeft.className = 'song-head-main';
  headLeft.append(toggle, title, meta);
  head.append(headLeft, modes, actions);

  const body = document.createElement('div');
  body.className = 'song-body';
  body.hidden = collapsed;

  if (asText) {
    body.append(renderTextEditor(songIndex));
  } else {
    if (song.arrangement.length) body.append(renderArrangement(song));
    song.groups.forEach((group, groupIndex) => {
      body.append(renderGroup(group, songIndex, groupIndex));
    });
  }

  node.append(head, body);
  return node;
}

/** The play order, as coloured chips. */
function renderArrangement(song) {
  const node = document.createElement('div');
  node.className = 'arrangement';
  const label = document.createElement('span');
  label.textContent = 'Arrangement:';
  node.append(label);
  for (const name of song.arrangement) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.setProperty('--group', cssColor(groupColor(name)));
    chip.textContent = name;
    node.append(chip);
  }
  return node;
}

/** A triangle that folds the thing it sits in front of. */
function disclosure(expanded, label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'disclosure';
  node.setAttribute('aria-expanded', String(expanded));
  node.title = label;
  node.setAttribute('aria-label', label);
  node.textContent = '▸';
  node.addEventListener('click', onClick);
  return node;
}

/** One half of the Slides/Text segmented control. */
function modeButton(label, selected, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'mode';
  node.setAttribute('aria-pressed', String(selected));
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

/** Add to a set, or take away if it is already there. */
const flip = (set, value) => (set.has(value) ? set.delete(value) : set.add(value));

// ── editing a song as text ───────────────────────────────────────────────────

/**
 * The whole song in one box, in the same shape "Copy text" produces.
 *
 * This is the fastest way to re-split a song by hand: a blank line is a slide
 * break, so moving one line onto the next slide is one keystroke rather than
 * two clicks and a retype. It is also the only way to rename a section or add
 * one that the parser never found.
 */
function renderTextEditor(songIndex) {
  const node = document.createElement('div');
  node.className = 'song-text';

  const hint = document.createElement('p');
  hint.className = 'hint-line';
  hint.append(
    'A blank line starts a new slide and ',
    code('[Chorus 1]'),
    ' names a section. ',
    code('Apply'),
    ' keeps the breaks exactly as you typed them; ',
    code('Re-split'),
    ' throws them away and re-runs the automatic layout.',
  );

  const area = document.createElement('textarea');
  area.className = 'text-box';
  area.spellcheck = false;
  area.setAttribute('aria-label', `${songs[songIndex].title} as text`);
  area.value = songToText(songs[songIndex]);
  // Capped so the buttons under the box stay within reach on a long song;
  // the box itself is resizable for anyone who wants the whole thing at once.
  area.rows = Math.min(24, area.value.split('\n').length + 2);

  const actions = document.createElement('div');
  actions.className = 'text-actions';
  const apply = button('Apply', 'small primary', () => {
    applyText(songIndex, area.value);
    flash(apply, 'Applied');
  });
  actions.append(
    apply,
    button('Re-split', 'small', () => applyText(songIndex, area.value, { resplit: true })),
    button('Revert', 'small ghost', () => {
      area.value = songToText(songs[songIndex]);
    }),
    hint,
  );

  node.append(area, actions);
  return node;
}

const code = (text) => {
  const node = document.createElement('code');
  node.textContent = text;
  return node;
};

/** The textarea holding one song's text, when that song is in text mode. */
const songTextarea = (songIndex) =>
  dom.songs.children[songIndex]?.querySelector('.song-text .text-box');

/**
 * Switch a song between card and text editing.
 *
 * Leaving text mode applies what is in the box first. Making someone press
 * Apply before switching back would only ever lose work.
 */
function setTextMode(songIndex, wantText) {
  if (textMode.has(songIndex) === wantText) return;
  if (!wantText) {
    const area = songTextarea(songIndex);
    if (area) {
      applyText(songIndex, area.value, { redraw: false });
    }
  }
  flip(textMode, songIndex);
  refreshSong(songIndex);
}

/**
 * Read a song back out of its text box.
 *
 * `resplit` discards the typed slide breaks and re-runs the reflow with the
 * toolbar's current limits, which is the way back once a hand-split has got
 * away from you.
 */
function applyText(songIndex, text, { resplit = false, redraw = true } = {}) {
  const parsedText = parseSongText(text);
  const song = songs[songIndex];
  const options = readSettings();

  const groups = parsedText.groups.map((group) => {
    const lines = group.slides.flat();
    return {
      ...group,
      lines,
      slides: resplit && !group.blank ? toSlides(lines, options) : group.slides,
    };
  });

  songs[songIndex] = {
    ...song,
    title: parsedText.title ?? song.title,
    // The title line no longer carries a key, so its absence says nothing: the
    // song keeps the key it was parsed with unless one is typed back in.
    key: parsedText.key ?? song.key,
    groups,
    arrangement: reconcileArrangement(song.arrangement, groups),
  };
  edited = true;
  if (redraw) refreshSong(songIndex);
  updateExport();
}

/**
 * Keep the play order across a text edit.
 *
 * The old arrangement is the one worth having - it carries the repeats - but
 * only while it still accounts for every section. Once a section has been
 * added or renamed there is no way to know where in the order it belongs, so
 * printed order is the honest answer.
 */
function reconcileArrangement(previous, groups) {
  const names = groups.map((g) => g.name);
  const present = new Set(names);
  const kept = previous.filter((name) => present.has(name));
  const covered = new Set(kept);
  return names.every((name) => covered.has(name)) ? kept : names;
}

// ── sections and slides ──────────────────────────────────────────────────────

function renderGroup(group, songIndex, groupIndex) {
  const node = document.createElement('section');
  node.className = 'group';
  node.style.setProperty('--group', cssColor(groupColor(group.name)));
  if (group.blank) node.classList.add('group-blank');

  const key = `${songIndex}:${groupIndex}`;
  const collapsed = collapsedGroups.has(key);
  node.classList.toggle('collapsed', collapsed);

  const head = document.createElement('div');
  head.className = 'group-head';
  const toggle = disclosure(!collapsed, `${collapsed ? 'Expand' : 'Collapse'} ${group.name}`, () => {
    flip(collapsedGroups, key);
    refreshSong(songIndex);
  });
  const swatch = document.createElement('span');
  swatch.className = 'group-swatch';
  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = group.name;
  name.addEventListener('click', () => toggle.click());
  const count = document.createElement('span');
  count.className = 'group-count';
  const n = countGroupSlides(group);
  count.textContent = `${n} slide${n === 1 ? '' : 's'}`;
  head.append(toggle, swatch, name, count);

  const slides = document.createElement('div');
  slides.className = 'slides';
  slides.hidden = collapsed;
  group.slides.forEach((lines, slideIndex) => {
    slides.append(renderSlide(lines, songIndex, groupIndex, slideIndex));
  });
  // Appends to the end, and is the only way back into a group whose slides
  // have all been deleted.
  slides.append(addSlideCard(songIndex, groupIndex));

  // Dropping on the gaps between cards - or anywhere in an empty section -
  // means "put it at the end here", which is what makes a section with no
  // slides left a reachable target at all.
  slides.addEventListener('dragover', (event) => {
    if (!isDropTarget(songIndex)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  slides.addEventListener('drop', (event) => {
    if (!isDropTarget(songIndex)) return;
    event.preventDefault();
    moveSlide(dragging, { groupIndex, at: songs[songIndex].groups[groupIndex].slides.length });
  });

  node.append(head, slides);
  return node;
}

/** The dashed card at the end of a group that appends a blank slide. */
function addSlideCard(songIndex, groupIndex) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'slide slide-add';
  node.title = 'Add a slide to the end of this section';
  node.setAttribute('aria-label', `Add a slide to ${songs[songIndex].groups[groupIndex].name}`);
  node.textContent = '+';
  node.addEventListener('click', () => {
    const group = songs[songIndex].groups[groupIndex];
    insertSlide(songIndex, groupIndex, group.slides.length);
  });
  return node;
}

function renderSlide(lines, songIndex, groupIndex, slideIndex) {
  const group = songs[songIndex].groups[groupIndex];
  const node = document.createElement('div');
  node.className = 'slide';
  if (group.blank) node.classList.add('slide-blank');
  if (lines.length === 0 || lines.every((line) => line.trim() === '')) {
    node.classList.add(group.blank ? 'blank' : 'empty');
  }

  const index = document.createElement('span');
  index.className = 'slide-index';
  index.textContent = slideIndex + 1;

  const area = document.createElement('textarea');
  area.value = lines.join('\n');
  area.rows = Math.max(2, lines.length);
  area.spellcheck = false;
  area.setAttribute('aria-label', `Slide ${slideIndex + 1}`);
  if (group.blank) area.placeholder = 'Blank — nothing is projected';
  area.addEventListener('input', () => {
    const current = songs[songIndex].groups[groupIndex];
    current.slides[slideIndex] = area.value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    edited = true;
    const isEmpty = current.slides[slideIndex].length === 0;
    node.classList.toggle('empty', isEmpty && !current.blank);
    node.classList.toggle('blank', isEmpty && Boolean(current.blank));
    updateCounts();
  });

  const controls = document.createElement('div');
  controls.className = 'slide-controls';
  controls.append(
    iconButton('+', `Add a slide after slide ${slideIndex + 1}`, () =>
      insertSlide(songIndex, groupIndex, slideIndex + 1),
    ),
    iconButton('×', `Remove slide ${slideIndex + 1}`, () =>
      removeSlide(songIndex, groupIndex, slideIndex),
    ),
  );

  node.append(index, grip(node, songIndex, groupIndex, slideIndex), area, controls);
  attachDragTarget(node, songIndex, groupIndex, slideIndex);
  return node;
}

/**
 * The handle a slide is dragged by.
 *
 * The card is only made draggable while the handle is held: a permanently
 * draggable card swallows text selection inside its own textarea, which is
 * where most of the editing happens. It is a real button, so the same reorder
 * is available from the keyboard with the arrow keys.
 */
function grip(node, songIndex, groupIndex, slideIndex) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'slide-grip';
  handle.title = 'Drag to move this slide — or use the arrow keys';
  handle.setAttribute('aria-label', `Move slide ${slideIndex + 1}`);
  handle.textContent = '⠿';

  handle.addEventListener('pointerdown', () => {
    node.draggable = true;
  });
  handle.addEventListener('pointerup', () => {
    node.draggable = false;
  });
  handle.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    nudgeSlide(songIndex, groupIndex, slideIndex, step);
  });

  node.addEventListener('dragstart', (event) => {
    dragging = { songIndex, groupIndex, slideIndex };
    event.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag unless the transfer carries something.
    event.dataTransfer.setData('text/plain', node.querySelector('textarea')?.value ?? '');
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    node.draggable = false;
    node.classList.remove('dragging');
    clearDropHints();
    dragging = null;
  });

  return handle;
}

/** Is there a drag in flight, and does it belong to this song? */
const isDropTarget = (songIndex) => dragging !== null && dragging.songIndex === songIndex;

/** Wire one slide card up as a place another slide can be dropped. */
function attachDragTarget(node, songIndex, groupIndex, slideIndex) {
  node.addEventListener('dragover', (event) => {
    if (!isDropTarget(songIndex)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    clearDropHints();
    node.classList.add(dropsAfter(event, node) ? 'drop-after' : 'drop-before');
  });
  node.addEventListener('dragleave', () => {
    node.classList.remove('drop-before', 'drop-after');
  });
  node.addEventListener('drop', (event) => {
    if (!isDropTarget(songIndex)) return;
    event.preventDefault();
    // Without this the section underneath also handles the drop and sends the
    // slide to the end instead of where it was let go.
    event.stopPropagation();
    moveSlide(dragging, {
      groupIndex,
      at: slideIndex + (dropsAfter(event, node) ? 1 : 0),
    });
  });
}

/**
 * Did the pointer come to rest past the middle of this card?
 *
 * Slides sit in a grid that is several cards wide on a desktop and one card
 * wide on a phone, so which axis decides "past the middle" depends on the
 * width the browser actually chose.
 */
function dropsAfter(event, node) {
  const box = node.getBoundingClientRect();
  const oneColumn = (node.parentElement?.clientWidth ?? 0) < box.width * 1.5;
  return oneColumn
    ? event.clientY > box.top + box.height / 2
    : event.clientX > box.left + box.width / 2;
}

const clearDropHints = () => {
  for (const node of dom.songs.querySelectorAll('.drop-before, .drop-after')) {
    node.classList.remove('drop-before', 'drop-after');
  }
};

/** A small square control that sits on a slide. */
function iconButton(glyph, label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'slide-control';
  node.textContent = glyph;
  node.title = label;
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

// ── adding and removing slides ───────────────────────────────────────────────

/**
 * Insert a blank slide and put the cursor in it.
 *
 * Slides carry their index in the closures that update them, so the whole song
 * is redrawn rather than patched - every slide after the insertion point has
 * shifted. Redrawing reads from `songs`, which already holds the edits, so
 * nothing typed is lost.
 */
function insertSlide(songIndex, groupIndex, at) {
  songs[songIndex].groups[groupIndex].slides.splice(at, 0, ['']);
  edited = true;
  refreshSong(songIndex);
  slideTextarea(songIndex, groupIndex, at)?.focus();
}

/**
 * Remove a slide outright.
 *
 * Distinct from clearing one: an emptied slide stays on screen as a dashed
 * placeholder you can type back into, whereas this takes it away. Removing the
 * last slide of a section leaves the section empty, and an empty section is
 * dropped from both exports.
 */
function removeSlide(songIndex, groupIndex, at) {
  songs[songIndex].groups[groupIndex].slides.splice(at, 1);
  edited = true;
  refreshSong(songIndex);
}

/**
 * Move a slide, within a section or into another one.
 *
 * `at` is an index into the destination *before* the slide is taken out of
 * where it was, which is what a drop position naturally is; moving down inside
 * one section therefore has to step back over the hole left behind.
 */
function moveSlide(from, to) {
  if (!from) return;
  const groups = songs[from.songIndex].groups;
  const source = groups[from.groupIndex];
  const target = groups[to.groupIndex];
  if (!source || !target) return;

  let at = to.at;
  if (source === target) {
    if (at === from.slideIndex || at === from.slideIndex + 1) return; // no-op
    if (from.slideIndex < at) at -= 1;
  }

  const [slide] = source.slides.splice(from.slideIndex, 1);
  if (slide === undefined) return;
  target.slides.splice(Math.max(0, Math.min(at, target.slides.length)), 0, slide);
  edited = true;
  refreshSong(from.songIndex);
}

/**
 * Move a slide one place with the keyboard.
 *
 * Off the end of a section it steps into the next one, so the arrow keys reach
 * everywhere a drag does. Focus follows the slide, so a run of presses moves it
 * as far as it needs to go.
 */
function nudgeSlide(songIndex, groupIndex, slideIndex, step) {
  const groups = songs[songIndex].groups;
  const within = slideIndex + step;

  if (within >= 0 && within < groups[groupIndex].slides.length) {
    moveSlide(
      { songIndex, groupIndex, slideIndex },
      { groupIndex, at: step > 0 ? within + 1 : within },
    );
    focusGrip(songIndex, groupIndex, within);
    return;
  }

  const nextGroup = groupIndex + step;
  if (nextGroup < 0 || nextGroup >= groups.length) return;
  const at = step > 0 ? 0 : groups[nextGroup].slides.length;
  moveSlide({ songIndex, groupIndex, slideIndex }, { groupIndex: nextGroup, at });
  focusGrip(songIndex, nextGroup, step > 0 ? 0 : groups[nextGroup].slides.length - 1);
}

/** Put focus back on a slide's handle after the song has been redrawn. */
function focusGrip(songIndex, groupIndex, slideIndex) {
  dom.songs.children[songIndex]
    ?.querySelectorAll('.group')[groupIndex]
    ?.querySelectorAll('.slide:not(.slide-add)')[slideIndex]
    ?.querySelector('.slide-grip')
    ?.focus();
}

/** Redraw one song in place, leaving the other songs and their edits alone. */
function refreshSong(songIndex) {
  const current = dom.songs.children[songIndex];
  if (!current) return;
  current.replaceWith(renderSong(songs[songIndex], songIndex));
  updateExport();
}

const slideTextarea = (songIndex, groupIndex, slideIndex) =>
  dom.songs.children[songIndex]
    ?.querySelectorAll('.group')[groupIndex]
    ?.querySelectorAll('.slide textarea')[slideIndex];

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
 * ProPresenter imports one presentation at a time, so a multi-song blob is for
 * saving or splitting up by hand rather than importing whole - which is why
 * each song also has its own button. Each song already opens on its own title
 * line, so run together there is still something to show where one ends.
 */
function copyAllSongs(trigger) {
  return copyToClipboard(songs.map((song) => songToText(song)).join('\n'), trigger);
}

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
for (const control of [
  dom.maxLines, dom.maxChars, dom.rejoinHyphens, dom.straightQuotes, dom.dropTrailingCommas,
  dom.blankFirstSlide,
]) {
  control.addEventListener('change', onSettingChanged);
}

dom.downloadAll.addEventListener('click', downloadAll);
dom.copyAll.addEventListener('click', () => copyAllSongs(dom.copyAll));
dom.reset.addEventListener('click', () => {
  parsed = [];
  songs = [];
  edited = false;
  resetView();
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
