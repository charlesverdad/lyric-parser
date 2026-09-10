/**
 * Plain-text export — and the way back in.
 *
 * ProPresenter imports a `.txt` file directly: a blank line starts a new
 * slide, and a line in square brackets names the group. It carries no
 * formatting, but it is trivially inspectable and survives any future change
 * to the binary format, so it is offered alongside `.pro`.
 *
 * `parseSongText` reads that same shape back, which is what the editor's text
 * mode is built on: the blank lines someone types *are* the slide breaks.
 */

import { BLANK_GROUP_NAME } from './reflow.js';
import { songFileStem } from './filenames.js';
import { parseTitle } from './song-parser.js';

/**
 * The song's own heading line.
 *
 * The title alone. A key belongs to the band, not to the congregation reading
 * the screen, and this line is one keystroke from being projected - so "(G)"
 * only ever arrives somewhere it is not wanted. The key still travels in the
 * `.pro`, in the `music_key` field ProPresenter reads it from.
 */
export const songTitleLine = (song) => song.title || 'Untitled';

/**
 * Render a song as an import-shaped text file.
 *
 * The title leads, on its own line and followed by a blank one, so the block
 * says which song it is instead of opening on a bare `[Verse 1]`. That line
 * does import as a slide of its own; the alternative — leaving the title to
 * the filename, which a pasted block does not have — loses it entirely.
 *
 * Below it only group headings and slides are written. An "Arrangement: ..."
 * footer would be separated by a blank line and so would import as another
 * slide, projecting metadata as if it were lyrics; the arrangement only exists
 * in the `.pro`, which is the format that models one.
 *
 * @param {{title: string, key?: string|null, groups: {name: string, blank?: boolean, slides: string[][]}[]}} song
 * @returns {string}
 */
export function songToText(song) {
  const blocks = song.groups
    .map((group) => ({
      name: group.name,
      blank: Boolean(group.blank),
      slides: group.slides.filter((slide) => slide.some((line) => line.trim() !== '')),
    }))
    // A group whose slides were all deleted would otherwise leave its heading
    // behind with nothing under it, and the blank line after it would import
    // as a slide showing the group name. The leading blank slide is the one
    // exception: it is *meant* to carry no words, and its heading is all that
    // survives into a format with no way to spell an empty slide.
    .filter((group) => group.blank || group.slides.length > 0)
    .map((group) =>
      group.blank
        ? `[${group.name}]`
        : `[${group.name}]\n${group.slides.map((s) => s.join('\n')).join('\n\n')}`,
    );
  return `${songTitleLine(song)}\n\n${blocks.join('\n\n')}\n`;
}

/** "[Verse 1]" on a line of its own. */
const HEADING_RE = /^\[\s*([^\]]+?)\s*\]\s*$/;

/**
 * Read `songToText`'s shape back into groups and slides.
 *
 * The inverse of the export, and deliberately forgiving: it parses whatever
 * someone has typed into the editor's text box, not only what was written out.
 * A blank line ends a slide, a bracketed line starts a group, and a single
 * line standing alone above the first heading is the title.
 *
 * Text above the first heading that is *not* a lone title line is kept as the
 * slides of an opening section rather than dropped — losing someone's lyrics
 * because they deleted a heading would be the worst failure available here.
 *
 * @param {string} text
 * @returns {{title: string|null, key: string|null, groups: {name: string, blank?: boolean, slides: string[][]}[]}}
 */
export function parseSongText(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');

  /** Slides of the leading, heading-less region, held until we know what it is. */
  const preamble = [];
  const groups = [];
  let current = null;
  let slide = [];

  const endSlide = () => {
    if (slide.length === 0) return;
    (current ? current.slides : preamble).push(slide);
    slide = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(HEADING_RE);
    if (heading) {
      endSlide();
      current = { name: heading[1], slides: [] };
      groups.push(current);
      continue;
    }
    if (line === '') {
      endSlide();
      continue;
    }
    slide.push(line);
  }
  endSlide();

  // One line alone above the first heading is the title, which is exactly what
  // the export writes. Anything longer is lyrics someone unheaded.
  let title = null;
  let key = null;
  if (preamble.length === 1 && preamble[0].length === 1) {
    const parsed = parseTitle(preamble[0][0]);
    title = parsed.title;
    key = parsed.key;
  } else if (preamble.length > 0) {
    groups.unshift({ name: 'Verse 1', slides: preamble });
  }

  return {
    title,
    key,
    groups: groups.map((group) =>
      group.name === BLANK_GROUP_NAME && group.slides.length === 0
        ? { name: group.name, blank: true, slides: [[]] }
        : group,
    ),
  };
}

/** A filesystem-safe name for a song's `.txt` file. */
export const textFileName = (song) => `${songFileStem(song)}.txt`;
