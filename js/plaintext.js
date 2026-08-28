/**
 * Plain-text export.
 *
 * ProPresenter imports a `.txt` file directly: a blank line starts a new
 * slide, and a line in square brackets names the group. It carries no
 * formatting, but it is trivially inspectable and survives any future change
 * to the binary format, so it is offered alongside `.pro`.
 */

/**
 * Render a song as an import-shaped text file.
 *
 * Only group headings and slides are written. A title banner or an
 * "Arrangement: ..." footer would each be separated by a blank line and so
 * would import as *extra slides*, projecting the metadata as if it were
 * lyrics. The title and key live in the filename instead, and the arrangement
 * only exists in the `.pro`, which is the format that models one.
 *
 * @param {{title: string, key?: string|null, groups: {name: string, slides: string[][]}[]}} song
 * @returns {string}
 */
export function songToText(song) {
  const blocks = song.groups.map((group) => {
    const slides = group.slides
      .filter((slide) => slide.some((line) => line.trim() !== ''))
      .map((slide) => slide.join('\n'))
      .join('\n\n');
    return `[${group.name}]\n${slides}`;
  });
  return `${blocks.join('\n\n')}\n`;
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
