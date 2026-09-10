/**
 * Filenames for exported songs.
 *
 * Shared by both writers so a song's `.pro` and its `.txt` always agree, and
 * kept out of either of them so neither has to import the other.
 */

/**
 * A song's filename, without an extension.
 *
 * The title alone: no key. On a `.txt` import the filename becomes the
 * presentation name, so a "(G)" here is the same "(G)" in the title by another
 * route — and the key is the band's business, not the screen's. It travels in
 * the `.pro`'s `music_key` field instead.
 *
 * @param {{title?: string|null}} song
 */
export function songFileStem(song) {
  return (song.title ?? '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}
