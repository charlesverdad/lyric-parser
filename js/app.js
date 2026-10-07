/**
 * Browser front end.
 *
 * Holds the parsed songs, re-runs layout when a setting changes, and lets
 * slides be edited before export. Every conversion step lives in the shared
 * modules under `js/`, so this file is only wiring and DOM.
 *
 * One song is shown at a time: a sidebar (wide windows) or a chip strip
 * (narrow ones) picks which.
 */

import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.min.mjs';
import { extractLines } from './pdf-text.js';
import { linesFromText } from './text-input.js';
import { parseSongs } from './song-parser.js';
import { normalizeSong } from './lyrics.js';
import { layoutSong, toSlides } from './reflow.js';
import { toFiles } from './pipeline.js';
import { songToText, parseSongText } from './plaintext.js';
import { createHistory, baseFromPath, idFromPath, formatWhen } from './history.js';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.2.108/pdf.worker.min.mjs';

const el = (id) => document.getElementById(id);

const dom = {
  totals: el('totals'), topActions: el('topActions'),
  copyAll: el('copyAll'), openSettings: el('openSettings'), reset: el('reset'),
  downloadAll: el('downloadAll'),
  inputScreen: el('inputScreen'), results: el('results'),
  drop: el('drop'), file: el('file'), status: el('status'),
  tabPdf: el('tabPdf'), tabPaste: el('tabPaste'),
  panelPdf: el('panelPdf'), panelPaste: el('panelPaste'),
  paste: el('paste'), convert: el('convert'), pasteSample: el('pasteSample'),
  strip: el('strip'), songList: el('songList'), songCount: el('songCount'),
  main: el('main'), position: el('position'), songTitle: el('songTitle'),
  songKey: el('songKey'), songMeta: el('songMeta'),
  modeSlides: el('modeSlides'), modeText: el('modeText'),
  copySong: el('copySong'), dlPro: el('dlPro'), dlTxt: el('dlTxt'),
  warnings: el('warnings'), notes: el('notes'), songBody: el('songBody'), songNav: el('songNav'),
  backdrop: el('backdrop'), closeSettings: el('closeSettings'),
  steppers: el('steppers'), toggles: el('toggles'),
  fontFamily: el('fontFamily'), fontSize: el('fontSize'), slideSize: el('slideSize'),
  toast: el('toast'),
  brand: el('brand'), recent: el('recent'), recentList: el('recentList'),
};

/** Parsed songs straight from the input, before normalisation or layout. */
let parsed = [];
/** Songs as currently laid out and possibly hand-edited. */
let songs = [];
/** Set once a slide has been edited, so settings changes can warn first. */
let edited = false;
let sourceName = 'songs';

// ── view state ───────────────────────────────────────────────────────────────
// How the editor is being looked at, not part of a song, so none of it is
// exported. Keyed by song index, hence cleared whenever the songs are re-derived.

/** Index of the song on show. */
let active = 0;
/** Song indices being edited as text rather than as cards. */
const textMode = new Set();
/** Unapplied text-mode edits, by song index, so switching songs loses nothing. */
const drafts = new Map();
/** The slide currently being dragged ({ groupIndex, slideIndex }), or null. */
let dragging = null;

function resetView({ keepActive = false } = {}) {
  active = keepActive ? Math.min(active, Math.max(0, songs.length - 1)) : 0;
  textMode.clear();
  drafts.clear();
  dragging = null;
}

// ── settings ─────────────────────────────────────────────────────────────────

const settings = {
  maxLines: 2,
  maxChars: 40,
  rejoinHyphens: true,
  straightQuotes: false,
  dropTrailingCommas: true,
  blankFirstSlide: true,
  fontFamily: 'Arial',
  fontSize: 64,
  slideSize: '1920x1080',
};

const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

/** The options the shared pipeline modules expect. */
function readSettings() {
  const [width, height] = settings.slideSize.split('x').map(Number);
  return { ...settings, slideSize: { width, height } };
}

const STEPPERS = [
  { key: 'maxLines', label: 'Lines per slide', min: 1, max: 6, step: 1 },
  { key: 'maxChars', label: 'Max characters per line', min: 16, max: 90, step: 2 },
];

const TOGGLES = [
  { key: 'rejoinHyphens', label: 'Rejoin split words', hint: 'for-gives → forgives' },
  { key: 'dropTrailingCommas', label: 'Drop trailing commas', hint: 'The line break already does its job' },
  { key: 'straightQuotes', label: 'Straighten quotes', hint: '’ → \'' },
  { key: 'blankFirstSlide', label: 'Blank slide first', hint: 'Cue a song before the first line goes up' },
];

/**
 * Change a layout setting. Re-splits every song, so it asks first if there are
 * hand edits to lose. Returns whether the change went ahead.
 */
function setLayoutSetting(key, value) {
  if (settings[key] === value) return true;
  if (parsed.length && (edited || hasUnappliedDraft()) && !confirm('Re-splitting the slides will discard your edits. Continue?')) {
    syncDrawer();
    return false;
  }
  settings[key] = value;
  if (parsed.length) relayout({ keepActive: true });
  syncDrawer();
  return true;
}

/** Text typed into a Text-mode box but not applied yet counts as a hand edit. */
const hasUnappliedDraft = () =>
  [...drafts].some(([index, text]) => songs[index] && text !== songToText(songs[index]));

function buildDrawer() {
  for (const spec of STEPPERS) {
    const row = document.createElement('div');
    row.className = 'stepper-row';
    const label = document.createElement('span');
    label.textContent = spec.label;
    const group = document.createElement('div');
    group.className = 'stepper';
    const dec = button('−', '', () => setLayoutSetting(spec.key, clamp(settings[spec.key] - spec.step, spec.min, spec.max)));
    const val = document.createElement('span');
    val.className = 'val';
    val.dataset.stepper = spec.key;
    const inc = button('+', '', () => setLayoutSetting(spec.key, clamp(settings[spec.key] + spec.step, spec.min, spec.max)));
    dec.dataset.dec = spec.key;
    inc.dataset.inc = spec.key;
    dec.setAttribute('aria-label', `Fewer: ${spec.label}`);
    inc.setAttribute('aria-label', `More: ${spec.label}`);
    group.append(dec, val, inc);
    row.append(label, group);
    dom.steppers.append(row);
  }
  for (const spec of TOGGLES) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'toggle-row';
    row.setAttribute('role', 'switch');
    row.dataset.toggle = spec.key;
    const text = document.createElement('span');
    text.className = 'lbl';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = spec.hint;
    text.append(name, hint);
    const sw = document.createElement('span');
    sw.className = 'switch';
    row.append(text, sw);
    row.addEventListener('click', () => setLayoutSetting(spec.key, !settings[spec.key]));
    dom.toggles.append(row);
  }
  syncDrawer();
}

/** Reflect `settings` in the drawer controls. */
function syncDrawer() {
  for (const spec of STEPPERS) {
    const v = settings[spec.key];
    dom.steppers.querySelector(`[data-stepper="${spec.key}"]`).textContent = String(v);
    dom.steppers.querySelector(`[data-dec="${spec.key}"]`).disabled = v <= spec.min;
    dom.steppers.querySelector(`[data-inc="${spec.key}"]`).disabled = v >= spec.max;
  }
  for (const spec of TOGGLES) {
    dom.toggles.querySelector(`[data-toggle="${spec.key}"]`)
      .setAttribute('aria-checked', String(settings[spec.key]));
  }
  dom.fontFamily.value = settings.fontFamily;
  dom.fontSize.value = String(settings.fontSize);
  dom.slideSize.value = settings.slideSize;
}

// Styling settings only affect export, so they never re-split anything.
dom.fontFamily.addEventListener('change', () => {
  settings.fontFamily = dom.fontFamily.value.trim() || 'Arial';
  syncDrawer();
  scheduleSave();
});
dom.fontSize.addEventListener('change', () => {
  settings.fontSize = clamp(Number(dom.fontSize.value), 12, 200);
  syncDrawer();
  scheduleSave();
});
dom.slideSize.addEventListener('change', () => {
  settings.slideSize = dom.slideSize.value;
  scheduleSave();
});

let drawerReturnFocus = null;

function openDrawer() {
  drawerReturnFocus = document.activeElement;
  dom.backdrop.hidden = false;
  dom.closeSettings.focus();
}

function closeDrawer() {
  if (dom.backdrop.hidden) return;
  dom.backdrop.hidden = true;
  drawerReturnFocus?.focus?.();
}

dom.openSettings.addEventListener('click', openDrawer);
dom.closeSettings.addEventListener('click', closeDrawer);
dom.backdrop.addEventListener('click', (event) => {
  if (event.target === dom.backdrop) closeDrawer();
});

// ── toast ────────────────────────────────────────────────────────────────────

let toastTimer = 0;

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 1800);
}

// ── loading ──────────────────────────────────────────────────────────────────

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle('error', isError);
}

async function loadPdf(file) {
  if (!file) return;
  const name = file.name.replace(/\.pdf$/i, '') || 'songs';
  setStatus(`Reading ${file.name}…`);
  dom.drop.classList.add('busy');

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const lines = await extractLines(doc);
    const found = parseSongs(lines);

    if (!found.length || found.every((s) => s.groups.length === 0)) {
      setStatus('No lyrics found in that PDF. Is it a scanned image rather than text?', true);
      return;
    }

    parsed = found;
    sourceName = name;
    setStatus('');
    relayout();
    beginSession();
    showScreen('results');
  } catch (error) {
    console.error(error);
    setStatus(`Could not read that PDF: ${error.message}`, true);
  } finally {
    dom.drop.classList.remove('busy');
    dom.file.value = '';
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
    const found = parseSongs(linesFromText(text));

    if (!found.length || found.every((s) => s.groups.length === 0)) {
      setStatus('No lyrics found in that text — every line looked like a chord or a direction.', true);
      return;
    }

    parsed = found;
    sourceName = parsed[0].title || 'songs';
    setStatus('');
    relayout();
    beginSession();
    showScreen('results');
  } catch (error) {
    console.error(error);
    setStatus(`Could not parse that text: ${error.message}`, true);
  }
}

/** Switch between the input screen and the results. */
function showScreen(which) {
  const results = which === 'results';
  dom.inputScreen.hidden = results;
  dom.results.hidden = !results;
  dom.topActions.hidden = !results;
  dom.totals.hidden = !results;
  document.body.classList.toggle('on-results', results);
  if (results) dom.main.scrollTop = 0;
}

/** Re-run normalisation and layout from the parsed source, discarding edits. */
function relayout({ keepActive = false } = {}) {
  const options = readSettings();
  songs = parsed
    .map((song) => normalizeSong(song, options))
    .map((song) => layoutSong(song, options));
  edited = false;
  resetView({ keepActive });
  render();
  scheduleSave();
}

/**
 * Slides that would actually be exported: an emptied one is not one.
 *
 * The leading blank section is the exception - its slide is empty on purpose
 * and is written out - so it counts every slide it has.
 */
const isEmptySlide = (lines) => lines.every((line) => line.trim() === '');

const countGroupSlides = (group) =>
  group.blank ? group.slides.length : group.slides.filter((slide) => !isEmptySlide(slide)).length;

const countSlides = (song) => song.groups.reduce((n, g) => n + countGroupSlides(g), 0);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── rendering ────────────────────────────────────────────────────────────────

/** Everything: chrome and the song on show. */
function render() {
  renderChrome();
  renderSong();
}

/**
 * The parts that summarise the songs: header totals, song list, song header.
 * Cheap enough to redo on every keystroke, and it leaves the slide cards alone
 * so typing keeps focus.
 */
function renderChrome() {
  const slides = songs.reduce((n, s) => n + countSlides(s), 0);
  const one = songs.length === 1;

  dom.totals.textContent = `${sourceName} · ${plural(songs.length, 'song')} · ${plural(slides, 'slide')}`;
  dom.copyAll.textContent = one ? 'Copy as text' : 'Copy all';
  dom.downloadAll.textContent = one ? 'Download .pro' : 'Download all (.zip)';
  dom.downloadAll.disabled = slides === 0;
  dom.copyAll.disabled = slides === 0;

  dom.songCount.textContent = String(songs.length);
  dom.songList.replaceChildren(...songs.map(songRow));
  dom.strip.replaceChildren(...songs.map(songChip));

  const song = songs[active];
  if (!song) return;
  dom.position.textContent = `SONG ${active + 1} OF ${songs.length}`;
  dom.songTitle.textContent = song.title;
  dom.songKey.hidden = !song.key;
  dom.songKey.textContent = song.key ?? '';
  dom.songMeta.textContent = [
    song.note,
    plural(song.groups.length, 'section'),
    plural(countSlides(song), 'slide'),
  ].filter(Boolean).join(' · ');
  const asText = textMode.has(active);
  dom.modeSlides.setAttribute('aria-pressed', String(!asText));
  dom.modeText.setAttribute('aria-pressed', String(asText));
}

function songRow(song, index) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'song-row';
  if (index === active) node.setAttribute('aria-current', 'true');
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(index + 1);
  const text = document.createElement('span');
  text.className = 'txt';
  const title = document.createElement('span');
  title.className = 't';
  title.textContent = song.title;
  const sub = document.createElement('span');
  sub.className = 's';
  sub.textContent = [song.key, plural(countSlides(song), 'slide')].filter(Boolean).join(' · ');
  text.append(title, sub);
  node.append(num, text);
  node.addEventListener('click', () => selectSong(index));
  return node;
}

function songChip(song, index) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'chip-song';
  if (index === active) node.setAttribute('aria-current', 'true');
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = String(index + 1);
  node.append(num, document.createTextNode(song.title));
  node.addEventListener('click', () => selectSong(index));
  return node;
}

function selectSong(index) {
  if (index < 0 || index >= songs.length || index === active) return;
  active = index;
  dragging = null;
  render();
  dom.main.scrollTop = 0;
  // Keep the chosen chip in view on a narrow window.
  dom.strip.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  dom.songList.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
}

/** The song on show: warnings, order, slides or text, and prev/next. */
function renderSong() {
  const song = songs[active];
  if (!song) return;

  renderWarnings(song);
  renderNotes(song);

  if (textMode.has(active)) {
    dom.songBody.replaceChildren(renderTextEditor());
  } else {
    dom.songBody.replaceChildren(...song.groups.map((group, gi) => renderGroup(group, gi)));
  }
  renderNav();
}

function renderWarnings(song) {
  if (!song.warnings.length) {
    dom.warnings.hidden = true;
    return;
  }
  dom.warnings.hidden = false;
  const heading = document.createElement('strong');
  heading.textContent = 'Worth a look';
  const list = document.createElement('ul');
  list.append(...song.warnings.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  dom.warnings.replaceChildren(heading, list);
}

/** The play order, and which words were rejoined. */
function renderNotes(song) {
  const joins = [...new Set(song.hyphenJoins ?? [])];
  if (!song.arrangement.some((n) => !song.groups.some((g) => g.blank && g.name === n)) && !joins.length) {
    dom.notes.hidden = true;
    dom.notes.replaceChildren();
    return;
  }
  dom.notes.hidden = false;
  const parts = [];
  if (song.arrangement.length) {
    const order = document.createElement('div');
    order.className = 'order';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Order';
    order.append(label);
    const blankNames = new Set(song.groups.filter((g) => g.blank).map((g) => g.name));
    for (const name of song.arrangement.filter((n) => !blankNames.has(n))) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = name;
      order.append(pill);
    }
    parts.push(order);
  }
  if (joins.length) {
    const line = document.createElement('div');
    line.className = 'joins';
    line.textContent = `Rejoined split words: ${joins.join(', ')}`;
    parts.push(line);
  }
  dom.notes.replaceChildren(...parts);
}

function renderNav() {
  const prev = songs[active - 1];
  const next = songs[active + 1];
  const card = (kind, label, song, target) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `nav-card ${kind}`;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = song.title;
    node.append(k, v);
    node.addEventListener('click', () => selectSong(target));
    return node;
  };
  dom.songNav.replaceChildren(
    ...(prev ? [card('prev', '← Previous', prev, active - 1)] : []),
    ...(next ? [card('next', 'Next song →', next, active + 1)] : []),
  );
  dom.songNav.hidden = !prev && !next;
}

// ── editing a song as text ───────────────────────────────────────────────────

/**
 * The whole song in one box, in the same shape "Copy text" produces.
 *
 * A blank line is a slide break, so moving one line onto the next slide is one
 * keystroke. It is also the only way to rename a section or add one the parser
 * never found.
 */
function renderTextEditor() {
  const node = document.createElement('div');
  node.className = 'text-edit';

  const area = document.createElement('textarea');
  area.className = 'text-box';
  area.spellcheck = false;
  area.setAttribute('aria-label', `${songs[active].title} as text`);
  area.value = drafts.get(active) ?? songToText(songs[active]);
  area.addEventListener('input', () => {
    drafts.set(active, area.value);
    scheduleSave();
  });

  const actions = document.createElement('div');
  actions.className = 'text-actions';
  const hint = document.createElement('span');
  hint.className = 'text-hint';
  hint.textContent =
    'A blank line starts a new slide and [Chorus 1] names a section. Re-split re-runs the automatic layout.';
  actions.append(
    button('Apply', 'btn primary', () => {
      applyText(active, area.value);
      toast('Applied');
    }),
    button('Re-split', 'btn secondary', () => {
      applyText(active, area.value, { resplit: true });
      toast('Re-split');
    }),
    button('Revert', 'btn ghost', () => {
      drafts.delete(active);
      area.value = songToText(songs[active]);
    }),
    hint,
  );

  node.append(area, actions);
  return node;
}

/**
 * Switch the song on show between card and text editing.
 *
 * Leaving text mode applies what is in the box first. Making someone press
 * Apply before switching back would only ever lose work.
 */
function setTextMode(wantText) {
  if (textMode.has(active) === wantText) return;
  if (wantText) {
    textMode.add(active);
  } else {
    if (drafts.has(active)) applyText(active, drafts.get(active), { redraw: false });
    textMode.delete(active);
  }
  render();
}

/**
 * Read a song back out of its text box.
 *
 * `resplit` discards the typed slide breaks and re-runs the reflow with the
 * current limits, which is the way back once a hand-split has got away from you.
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
  drafts.delete(songIndex);
  markEdited();
  if (redraw) render();
  else renderChrome();
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

/** Which colour family a section belongs to; the colours live in styles.css. */
function groupKind(group) {
  if (group.blank) return 'blank';
  const name = group.name.toLowerCase();
  if (/^pre/.test(name)) return 'pre';
  if (/chorus/.test(name)) return 'chorus';
  if (/verse/.test(name)) return 'verse';
  if (/bridge/.test(name)) return 'bridge';
  if (/tag|repeat|outro|ending/.test(name)) return 'tag';
  if (/interlude|inst/.test(name)) return 'interlude';
  return 'other';
}

function renderGroup(group, groupIndex) {
  const node = document.createElement('section');
  node.className = 'group';
  node.dataset.kind = groupKind(group);

  const head = document.createElement('div');
  head.className = 'group-head';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = group.blank ? 'Opening blank' : group.name;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = groupCountLabel(group);
  head.append(dot, name, count);

  const slides = document.createElement('div');
  slides.className = 'slides';
  group.slides.forEach((lines, slideIndex) => {
    slides.append(renderSlide(lines, groupIndex, slideIndex));
  });
  // Appends to the end, and is the only way back into a group whose slides
  // have all been deleted.
  if (!group.blank) slides.append(addSlideCard(groupIndex));

  // Dropping on the gaps between cards - or anywhere in an empty section -
  // means "put it at the end here", which is what makes a section with no
  // slides left a reachable target at all.
  slides.addEventListener('dragover', (event) => {
    if (!dragging || group.blank) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  slides.addEventListener('drop', (event) => {
    if (!dragging || group.blank) return;
    event.preventDefault();
    moveSlide(dragging, { groupIndex, at: songs[active].groups[groupIndex].slides.length });
  });

  node.append(head, slides);
  return node;
}

const groupCountLabel = (group) =>
  group.blank ? 'Cue the song before the first line goes up' : plural(countGroupSlides(group), 'slide');

/** The dashed card at the end of a group that appends a blank slide. */
function addSlideCard(groupIndex) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'slide-add';
  node.title = 'Add a slide to the end of this section';
  node.setAttribute('aria-label', `Add a slide to ${songs[active].groups[groupIndex].name}`);
  node.textContent = '+';
  node.addEventListener('click', () => {
    insertSlide(groupIndex, songs[active].groups[groupIndex].slides.length);
  });
  return node;
}

function slideCaption(group, slideIndex, empty) {
  const n = slideIndex + 1;
  return empty && !group.blank ? `${n} · empty, skipped on export` : String(n);
}

function renderSlide(lines, groupIndex, slideIndex) {
  const group = songs[active].groups[groupIndex];
  const node = document.createElement('div');
  node.className = 'slide';
  const empty = isEmptySlide(lines);
  node.classList.toggle('blank', empty && Boolean(group.blank));
  node.classList.toggle('empty', empty && !group.blank);

  const card = document.createElement('div');
  card.className = 'card';
  const area = document.createElement('textarea');
  area.value = lines.join('\n');
  area.rows = Math.max(2, lines.length);
  area.spellcheck = false;
  area.setAttribute('aria-label', `Slide ${slideIndex + 1}`);
  area.placeholder = group.blank ? 'Blank — nothing is projected' : 'Type a line…';
  card.append(area);

  const caption = document.createElement('div');
  caption.className = 'caption';
  const label = document.createElement('span');
  label.className = 'cap-text';
  label.textContent = slideCaption(group, slideIndex, empty);

  area.addEventListener('input', () => {
    const current = songs[active].groups[groupIndex];
    current.slides[slideIndex] = area.value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    markEdited();
    const nowEmpty = current.slides[slideIndex].length === 0;
    node.classList.toggle('empty', nowEmpty && !current.blank);
    node.classList.toggle('blank', nowEmpty && Boolean(current.blank));
    label.textContent = slideCaption(current, slideIndex, nowEmpty);
    area.rows = Math.max(2, area.value.split('\n').length);
    updateCounts(groupIndex);
  });

  const tools = document.createElement('div');
  tools.className = 'cap-tools';
  if (!group.blank) {
    tools.append(
      grip(node, groupIndex, slideIndex),
      cardButton('+', `Add a slide after slide ${slideIndex + 1}`, () => insertSlide(groupIndex, slideIndex + 1)),
      cardButton('×', `Remove slide ${slideIndex + 1}`, () => removeSlide(groupIndex, slideIndex)),
    );
  }
  caption.append(label, tools);

  node.append(card, caption);
  if (!group.blank) attachDragTarget(node, groupIndex, slideIndex);
  return node;
}

/** Refresh the tallies after an edit, without touching the cards. */
function updateCounts(groupIndex) {
  const song = songs[active];
  const groupNode = dom.songBody.querySelectorAll('.group')[groupIndex];
  const count = groupNode?.querySelector('.group-count');
  if (count) count.textContent = groupCountLabel(song.groups[groupIndex]);
  renderChrome();
}

/**
 * The handle a slide is dragged by.
 *
 * The card is only made draggable while the handle is held: a permanently
 * draggable card swallows text selection inside its own textarea, which is
 * where most of the editing happens. It is a real button, so the same reorder
 * is available from the keyboard with the arrow keys.
 */
function grip(node, groupIndex, slideIndex) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'card-btn grip';
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
    nudgeSlide(groupIndex, slideIndex, step);
  });

  node.addEventListener('dragstart', (event) => {
    dragging = { groupIndex, slideIndex };
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

/** Wire one slide card up as a place another slide can be dropped. */
function attachDragTarget(node, groupIndex, slideIndex) {
  node.addEventListener('dragover', (event) => {
    if (!dragging) return;
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
    if (!dragging) return;
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
  for (const node of dom.songBody.querySelectorAll('.drop-before, .drop-after')) {
    node.classList.remove('drop-before', 'drop-after');
  }
};

/** A small square control under a slide card. */
function cardButton(glyph, label, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'card-btn';
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
function insertSlide(groupIndex, at) {
  songs[active].groups[groupIndex].slides.splice(at, 0, ['']);
  markEdited();
  render();
  slideTextarea(groupIndex, at)?.focus();
}

/**
 * Remove a slide outright.
 *
 * Distinct from clearing one: an emptied slide stays on screen as a dashed
 * placeholder you can type back into, whereas this takes it away. Removing the
 * last slide of a section leaves the section empty, and an empty section is
 * dropped from both exports.
 */
function removeSlide(groupIndex, at) {
  songs[active].groups[groupIndex].slides.splice(at, 1);
  markEdited();
  render();
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
  const groups = songs[active].groups;
  const source = groups[from.groupIndex];
  const target = groups[to.groupIndex];
  if (!source || !target || target.blank) return;

  let at = to.at;
  if (source === target) {
    if (at === from.slideIndex || at === from.slideIndex + 1) return; // no-op
    if (from.slideIndex < at) at -= 1;
  }

  const [slide] = source.slides.splice(from.slideIndex, 1);
  if (slide === undefined) return;
  target.slides.splice(Math.max(0, Math.min(at, target.slides.length)), 0, slide);
  markEdited();
  dragging = null;
  render();
}

/**
 * Move a slide one place with the keyboard.
 *
 * Off the end of a section it steps into the next one, so the arrow keys reach
 * everywhere a drag does. Focus follows the slide, so a run of presses moves it
 * as far as it needs to go.
 */
function nudgeSlide(groupIndex, slideIndex, step) {
  const groups = songs[active].groups;
  const within = slideIndex + step;

  if (within >= 0 && within < groups[groupIndex].slides.length) {
    moveSlide({ groupIndex, slideIndex }, { groupIndex, at: step > 0 ? within + 1 : within });
    focusGrip(groupIndex, within);
    return;
  }

  const nextGroup = groupIndex + step;
  if (nextGroup < 0 || nextGroup >= groups.length) return;
  const at = step > 0 ? 0 : groups[nextGroup].slides.length;
  moveSlide({ groupIndex, slideIndex }, { groupIndex: nextGroup, at });
  focusGrip(nextGroup, step > 0 ? 0 : groups[nextGroup].slides.length - 1);
}

const slideNodes = (groupIndex) =>
  dom.songBody.querySelectorAll('.group')[groupIndex]?.querySelectorAll('.slide');

/** Put focus back on a slide's handle after the song has been redrawn. */
function focusGrip(groupIndex, slideIndex) {
  slideNodes(groupIndex)?.[slideIndex]?.querySelector('.grip')?.focus();
}

const slideTextarea = (groupIndex, slideIndex) =>
  slideNodes(groupIndex)?.[slideIndex]?.querySelector('textarea');

function button(label, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  if (className) node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

// ── clipboard ────────────────────────────────────────────────────────────────

/**
 * Copy text, telling the user which way it went.
 *
 * `navigator.clipboard` needs a secure context and can still be refused by
 * permissions policy, so a failure is expected rather than exceptional.
 */
async function copyToClipboard(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch (error) {
    console.error(error);
    toast('Could not reach the clipboard');
  }
}

const copySong = () => copyToClipboard(songToText(songs[active]), `Copied ${songs[active].title}`);

/**
 * Copy every song as one block.
 *
 * ProPresenter imports one presentation at a time, so a multi-song blob is for
 * saving or splitting up by hand rather than importing whole - which is why
 * each song also has its own button. Each song already opens on its own title
 * line, so run together there is still something to show where one ends.
 */
const copyAllSongs = () =>
  copyToClipboard(
    songs.map((song) => songToText(song)).join('\n'),
    songs.length === 1 ? `Copied ${songs[0].title}` : `Copied ${songs.length} songs`,
  );

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
  toast(`Downloaded ${pro.name}`);
}

function downloadText(index) {
  const { text } = renderFiles()[index];
  saveBlob(new Blob([text.text], { type: 'text/plain' }), text.name);
  toast(`Downloaded ${text.name}`);
}

async function downloadAll() {
  // One song still goes out as a plain .pro - a zip holding a single file is
  // just an extra step - and the button says so.
  if (songs.length === 1) {
    downloadPro(0);
    return;
  }
  if (typeof JSZip === 'undefined') {
    toast('The zip library did not load; download songs individually.');
    return;
  }
  const zip = new JSZip();
  for (const { pro, text } of renderFiles()) {
    zip.file(pro.name, pro.bytes);
    zip.file(`text/${text.name}`, text.text);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, `${sourceName}.zip`);
  toast(`Downloaded ${sourceName}.zip`);
}

// ── events ───────────────────────────────────────────────────────────────────

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

dom.downloadAll.addEventListener('click', downloadAll);
dom.copyAll.addEventListener('click', copyAllSongs);
dom.copySong.addEventListener('click', copySong);
dom.dlPro.addEventListener('click', () => downloadPro(active));
dom.dlTxt.addEventListener('click', () => downloadText(active));
dom.modeSlides.addEventListener('click', () => setTextMode(false));
dom.modeText.addEventListener('click', () => setTextMode(true));

dom.reset.addEventListener('click', () => {
  dom.file.value = '';
  dom.paste.value = '';
  goHome({ push: true });
});

// ↑/↓ and j/k switch songs when focus is not in a field.
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    closeDrawer();
    return;
  }
  if (dom.results.hidden || !dom.backdrop.hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowDown' || event.key === 'j') {
    event.preventDefault();
    selectSong(active + 1);
  } else if (event.key === 'ArrowUp' || event.key === 'k') {
    event.preventDefault();
    selectSong(active - 1);
  }
});

// ── input mode ───────────────────────────────────────────────────────────────

/** Switch between the file and paste inputs. */
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

// ── history and routing ──────────────────────────────────────────────────────
// Every parse gets a uuid and the URL becomes <base>/<uuid>. The parse itself is
// kept in localStorage (see history.js), so the URL survives a reload, the back
// button and an accidental trip to the main menu.

const store = createHistory({
  storage: (() => {
    try { return window.localStorage; } catch { return null; }
  })(),
});

/** The directory the app is served from: "/" locally, "/lyric-parser/" on Pages. */
const BASE = baseFromPath(location.pathname);

/** Id and creation time of the parse on show; null on the main menu. */
let currentId = null;
let currentCreated = 0;

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let saveTimer = 0;

/** Everything needed to restore the results screen exactly. No PDF bytes. */
const snapshot = () => ({
  id: currentId,
  title: sourceName,
  songCount: songs.length,
  createdAt: currentCreated,
  updatedAt: Date.now(),
  sourceName, parsed, songs, settings: { ...settings }, edited,
  // Typed-but-unapplied Text-mode boxes stay drafts across a restore.
  drafts: [...drafts],
  textMode: [...textMode],
  active,
});

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (currentId && parsed.length) store.save(snapshot());
}

/** Debounced, so typing does not rewrite storage on every keystroke. */
function scheduleSave() {
  if (!currentId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

function markEdited() {
  edited = true;
  scheduleSave();
}

/** A parse just succeeded: name it, save it and point the URL at it. */
function beginSession() {
  currentId = newId();
  currentCreated = Date.now();
  saveNow();
  window.history.pushState(null, '', BASE + currentId);
}

/** Show a saved parse. Returns false if the entry is unusable. */
function openEntry(entry) {
  if (!entry || !Array.isArray(entry.parsed) || !Array.isArray(entry.songs) || !entry.songs.length) {
    return false;
  }
  // Whatever is on show is saved before it is replaced, and any pending
  // debounce is cancelled so it cannot save the wrong parse afterwards.
  if (currentId) saveNow();
  try {
    return restoreEntry(entry);
  } catch (error) {
    console.error(error);
    currentId = null;
    parsed = [];
    songs = [];
    resetView();
    return false;
  }
}

function restoreEntry(entry) {
  parsed = entry.parsed;
  songs = entry.songs;
  Object.assign(settings, entry.settings ?? {});
  sourceName = entry.sourceName ?? entry.title ?? 'songs';
  edited = Boolean(entry.edited);
  currentId = entry.id;
  currentCreated = entry.createdAt ?? Date.now();
  resetView();
  if (Array.isArray(entry.drafts)) {
    for (const [index, text] of entry.drafts) {
      if (songs[index] && typeof text === 'string') drafts.set(index, text);
    }
  }
  if (Array.isArray(entry.textMode)) {
    for (const index of entry.textMode) if (songs[index]) textMode.add(index);
  }
  if (Number.isInteger(entry.active) && songs[entry.active]) active = entry.active;
  closeDrawer();
  syncDrawer();
  setStatus('');
  render();
  showScreen('results');
  return true;
}

/**
 * Back to the main menu. Edits are saved first (including text typed into a
 * Text-mode box but not applied), so nothing is lost by going home.
 */
function goHome({ push = false } = {}) {
  // Unapplied drafts are saved as drafts, not applied: the user can still Apply or Revert.
  saveNow();
  currentId = null;
  parsed = [];
  songs = [];
  edited = false;
  resetView();
  closeDrawer();
  setStatus('');
  showScreen('input');
  renderRecent();
  if (push && location.pathname !== BASE) window.history.pushState(null, '', BASE);
}

/** Make the screen match the URL. Runs on load and on back/forward. */
function route() {
  const id = idFromPath(location.pathname);
  if (!id) {
    goHome();
    return;
  }
  if (id === currentId && !dom.results.hidden) return;
  if (currentId) saveNow();
  if (!openEntry(store.get(id))) {
    goHome();
    setStatus(NOT_FOUND);
  }
}

const NOT_FOUND = "That parse isn't in this browser's history. It may have been removed or expired.";

function renderRecent() {
  const entries = store.list();
  dom.recent.hidden = entries.length === 0;
  dom.recentList.replaceChildren(...entries.map((entry) => {
    const row = document.createElement('li');
    row.className = 'recent-row';
    const link = document.createElement('a');
    link.className = 'recent-link';
    link.href = BASE + entry.id;
    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    meta.textContent = `${plural(entry.songCount, 'song')} · ${formatWhen(entry.updatedAt)}`;
    link.append(title, meta);
    link.addEventListener('click', (event) => {
      // Let the browser handle open-in-new-tab and friends.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (openEntry(store.get(entry.id))) {
        window.history.pushState(null, '', BASE + entry.id);
      } else {
        goHome();
        setStatus(NOT_FOUND);
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-remove';
    remove.textContent = '×';
    remove.title = `Remove ${entry.title} from history`;
    remove.setAttribute('aria-label', `Remove ${entry.title} from history`);
    remove.addEventListener('click', () => {
      store.remove(entry.id);
      renderRecent();
    });
    row.append(link, remove);
    return row;
  }));
}

dom.brand.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  goHome({ push: true });
});
window.addEventListener('popstate', route);
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

buildDrawer();
route();
