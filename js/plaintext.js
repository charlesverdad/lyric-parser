/**
 * Plain-text export.
 *
 * ProPresenter imports a `.txt` file directly: a blank line starts a new
 * slide, and a line in square brackets names the group. It carries no
 * formatting, but it is trivially inspectable and survives any future change
 * to the binary format, so it is offered alongside `.pro`.
 */

/**
 * @param {{title: string, key?: string|null, groups: {name: string, slides: string[][]}[], arrangement: string[]}} song
 * @param {{includeArrangement?: boolean}} [options]
 * @returns {string}
 */
export function songToText(song, options = {}) {
  const { includeArrangement = true } = options;
  const blocks = [];

  for (const group of song.groups) {
    const slides = group.slides.map((slide) => slide.join('\n')).join('\n\n');
    blocks.push(`[${group.name}]\n${slides}`);
  }

  const header = [song.title, song.key ? `Key: ${song.key}` : null]
    .filter(Boolean)
    .join('\n');

  const footer =
    includeArrangement && song.arrangement.length
      ? `\n\nArrangement: ${song.arrangement.join(' | ')}`
      : '';

  return `${header}\n\n${blocks.join('\n\n')}${footer}\n`;
}

/** A filesystem-safe name for a song's `.txt` file. */
export function textFileName(song) {
  const base = [song.title, song.key ? `(${song.key})` : null]
    .filter(Boolean)
    .join(' ')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'Untitled'}.txt`;
}
