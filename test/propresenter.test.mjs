import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentation, proFileName, groupColor } from '../js/propresenter.js';
import { songToText, textFileName } from '../js/plaintext.js';
import { uniqueNames } from '../js/pipeline.js';
import { decodeProto, sub, str, fakeUuids } from './helpers.mjs';

// Presentation field numbers, from proto/presentation.proto.
const F = {
  applicationInfo: 1, uuid: 2, name: 3, category: 6, background: 8,
  selectedArrangement: 10, arrangements: 11, cueGroups: 12, cues: 13,
  ccli: 14, musicKey: 22,
};

const SONG = {
  title: 'Yours Alone',
  key: 'G',
  groups: [
    { name: 'Verse 1', slides: [['Oh, what a love is this', 'That rescues and forgives?'], ['You suffered in our place']] },
    { name: 'Chorus 1', slides: [['We are Yours alone']] },
  ],
  arrangement: ['Verse 1', 'Chorus 1', 'Verse 1'],
};

const build = (song = SONG, options = {}) =>
  decodeProto(buildPresentation(song, {
    uuid: fakeUuids(), now: new Date('2026-01-01T00:00:00Z'), ...options,
  }));

test('writes the song title, category and key', () => {
  const doc = build();
  assert.equal(str(doc, F.name), 'Yours Alone');
  assert.equal(str(doc, F.category), 'Song');
  assert.equal(str(doc, F.musicKey), 'G');
});

test('claims ProPresenter as the authoring application', () => {
  const info = sub(build(), F.applicationInfo);
  assert.equal(info[3][0], 1); // APPLICATION_PROPRESENTER
  const version = sub(info, 4);
  assert.equal(version[1][0], 7);
});

test('writes one cue group per song section, with its slides', () => {
  const doc = build();
  assert.equal(doc[F.cueGroups].length, 2);

  const verse = sub(doc, F.cueGroups, 0);
  assert.equal(str(sub(verse, 1), 2), 'Verse 1');
  assert.equal(verse[2].length, 2, 'Verse 1 has two slides');

  const chorus = sub(doc, F.cueGroups, 1);
  assert.equal(str(sub(chorus, 1), 2), 'Chorus 1');
  assert.equal(chorus[2].length, 1);
});

test('writes one cue per slide', () => {
  assert.equal(build()[F.cues].length, 3);
});

test('cue identifiers in a group match real cues', () => {
  const doc = build();
  const cueUuids = new Set(doc[F.cues].map((c) => str(sub(decodeProto(c), 1), 1)));
  for (const group of doc[F.cueGroups]) {
    for (const ref of decodeProto(group)[2]) {
      assert.ok(cueUuids.has(str(decodeProto(ref), 1)), 'dangling cue reference');
    }
  }
});

test('the arrangement references groups in play order, repeats included', () => {
  const doc = build();
  const arrangement = sub(doc, F.arrangements);
  assert.equal(str(arrangement, 2), 'Default');

  const groupUuids = doc[F.cueGroups].map((g) => str(sub(sub(decodeProto(g), 1), 1), 1));
  const order = arrangement[3].map((b) => str(decodeProto(b), 1));
  assert.deepEqual(order, [groupUuids[0], groupUuids[1], groupUuids[0]]);
});

test('the selected arrangement points at the arrangement it wrote', () => {
  const doc = build();
  assert.equal(
    str(sub(doc, F.selectedArrangement), 1),
    str(sub(sub(doc, F.arrangements), 1), 1),
  );
});

test('each slide carries its lyrics as RTF', () => {
  const doc = build();
  const rtfOf = (cueBytes) => {
    const action = sub(decodeProto(cueBytes), 10);
    const slide = sub(sub(sub(action, 23), 2), 1); // slide > presentation > base_slide
    const element = sub(sub(slide, 1), 1); // Slide.Element > Graphics.Element
    return str(sub(element, 13), 5); // text > rtf_data
  };
  const texts = doc[F.cues].map(rtfOf);
  assert.match(texts[0], /Oh, what a love is this\\\nThat rescues and forgives\?/);
  assert.match(texts[1], /You suffered in our place/);
  assert.match(texts[2], /We are Yours alone/);
});

test('slides are 1920x1080 unless told otherwise', () => {
  const doc = build();
  const action = sub(decodeProto(doc[F.cues][0]), 10);
  const slide = sub(sub(sub(action, 23), 2), 1);
  const size = sub(slide, 6);
  assert.equal(size[1][0], 1920);
  assert.equal(size[2][0], 1080);

  const custom = build(SONG, { slideSize: { width: 1280, height: 720 } });
  const customSlide = sub(sub(sub(sub(decodeProto(custom[F.cues][0]), 10), 23), 2), 1);
  assert.equal(sub(customSlide, 6)[1][0], 1280);
});

test('the lyrics element is marked as a text element', () => {
  // Every text element in real ProPresenter documents carries info = 2.
  const doc = build();
  const action = sub(decodeProto(doc[F.cues][0]), 10);
  const slide = sub(sub(sub(action, 23), 2), 1);
  const slideElement = sub(slide, 1);
  assert.equal(slideElement[4][0], 2, 'Slide.Element.info should be 2');
});

test('cues and their actions are labelled with the section name', () => {
  const doc = build();
  const cue = decodeProto(doc[F.cues][0]);
  assert.equal(str(cue, 2), 'Verse 1');
  const action = sub(cue, 10);
  assert.equal(str(action, 2), 'Verse 1');
  // Action.Label.text is field 2 - field 1 is reserved in the schema.
  assert.equal(str(sub(action, 3), 2), 'Verse 1');
});

test('the text box is inset from the slide edge', () => {
  const doc = build(SONG, { margin: 80, slideSize: { width: 1920, height: 1080 } });
  const action = sub(decodeProto(doc[F.cues][0]), 10);
  const slide = sub(sub(sub(action, 23), 2), 1);
  const bounds = sub(sub(sub(slide, 1), 1), 3);
  const origin = sub(bounds, 1);
  const size = sub(bounds, 2);
  assert.equal(origin[1][0], 80);
  assert.equal(origin[2][0], 80);
  assert.equal(size[1][0], 1760);
  assert.equal(size[2][0], 920);
});

test('the slide element carries a four-cornered rectangle path', () => {
  const doc = build();
  const action = sub(decodeProto(doc[F.cues][0]), 10);
  const slide = sub(sub(sub(action, 23), 2), 1);
  const element = sub(sub(slide, 1), 1);
  const path = sub(element, 8);
  assert.equal(path[2].length, 4, 'a rectangle needs all four corners');
});

test('group colours follow section names', () => {
  assert.deepEqual(groupColor('Verse 2'), groupColor('Verse 1'));
  assert.notDeepEqual(groupColor('Chorus 1'), groupColor('Verse 1'));
  assert.deepEqual(groupColor('Pre-Chorus 1'), groupColor('Pre-Chorus 2'));
  assert.deepEqual(groupColor('Something Odd'), { red: 0.4, green: 0.4, blue: 0.4 });
});

test('is byte-reproducible given fixed uuids and time', () => {
  const options = { uuid: fakeUuids(), now: new Date('2026-01-01T00:00:00Z') };
  const a = buildPresentation(SONG, { ...options, uuid: fakeUuids() });
  const b = buildPresentation(SONG, { ...options, uuid: fakeUuids() });
  assert.deepEqual([...a], [...b]);
});

test('builds file names safe for any filesystem', () => {
  assert.equal(proFileName(SONG), 'Yours Alone (G).pro');
  assert.equal(proFileName({ title: 'A/B: C?', key: null }), 'A-B- C-.pro');
  assert.equal(proFileName({ title: '', key: null }), 'Untitled.pro');
  assert.equal(textFileName(SONG), 'Yours Alone (G).txt');
});

test('plain-text export separates slides by a blank line under a group heading', () => {
  const text = songToText(SONG);
  assert.match(text, /\[Verse 1\]\nOh, what a love is this\nThat rescues and forgives\?\n\nYou suffered in our place/);
  assert.match(text, /\[Chorus 1\]\nWe are Yours alone/);
});

test('plain-text export writes nothing that would import as a stray slide', () => {
  // A title banner or arrangement footer is separated by a blank line, so
  // ProPresenter would import it as an extra slide of "lyrics".
  const text = songToText(SONG);
  assert.ok(!text.includes('Arrangement:'), 'arrangement footer would be a slide');
  assert.ok(!text.includes('Key:'), 'key header would be a slide');
  assert.ok(text.startsWith('[Verse 1]'), `unexpected leading block: ${text.slice(0, 40)}`);
});

test('numbers colliding filenames instead of overwriting', () => {
  assert.deepEqual(
    uniqueNames(['A.pro', 'B.pro', 'A.pro', 'A.pro']),
    ['A.pro', 'B.pro', 'A (2).pro', 'A (3).pro'],
  );
  assert.deepEqual(uniqueNames(['Untitled.txt', 'Untitled.txt']), [
    'Untitled.txt', 'Untitled (2).txt',
  ]);
});

test('an emptied slide is not exported as a blank cue', () => {
  const withBlank = {
    ...SONG,
    groups: [{ name: 'Verse 1', slides: [['a line'], [], ['', '  ']] }],
    arrangement: ['Verse 1'],
  };
  const doc = build(withBlank);
  assert.equal(doc[F.cues].length, 1, 'only the slide with words should survive');
  assert.equal(sub(doc, F.cueGroups)[2].length, 1);
});

test('a group whose slides are all empty exports no cues', () => {
  const doc = build({ ...SONG, groups: [{ name: 'Verse 1', slides: [[], ['']] }], arrangement: ['Verse 1'] });
  assert.equal(doc[F.cues], undefined);
});

test('a section whose slides were all deleted is dropped, not left empty', () => {
  const song = {
    title: 'Edited',
    key: null,
    groups: [
      { name: 'Verse 1', slides: [['Kept line']] },
      { name: 'Chorus 1', slides: [] },
      { name: 'Bridge', slides: [['   '], ['']] },
    ],
    arrangement: ['Verse 1', 'Chorus 1', 'Bridge'],
  };

  const doc = decodeProto(buildPresentation(song, { uuid: fakeUuids() }));

  assert.equal(doc[F.cueGroups].length, 1, 'only the section with slides survives');
  assert.equal(str(sub(sub(doc, F.cueGroups, 0), 1), 2), 'Verse 1');
  assert.equal(doc[F.cues].length, 1);

  // The arrangement must not point at groups that are no longer there.
  const arrangement = sub(doc, F.arrangements);
  assert.equal(arrangement[3].length, 1);
});
