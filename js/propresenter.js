/**
 * Build a ProPresenter document (`.pro`) for one song.
 *
 * ProPresenter 7 and every later version (17, 18, 19, 21 …) serialise
 * documents as protocol buffers. The field numbers below come from the
 * vendored definitions in `proto/`; `tools/check-pro.mjs` decodes every
 * generated file with `protoc --decode=rv.data.Presentation` against those same
 * definitions, so a wrong number fails CI rather than surfacing as a file that
 * silently will not open.
 *
 * The document models a song the way ProPresenter does: each distinct
 * Verse/Chorus/Bridge is a *group* holding its slides, and an *arrangement*
 * references those groups in play order, so a chorus sung three times is one
 * group cued three times.
 */

import { Writer, encode } from './protobuf.js';
import { slideRtf } from './rtf.js';

// ── enum values ──────────────────────────────────────────────────────────────
const APPLICATION_PROPRESENTER = 1;
const ACTION_TYPE_PRESENTATION_SLIDE = 11;
const VERTICAL_ALIGNMENT_MIDDLE = 1;
const SCALE_BEHAVIOR_SCALE_FONT_DOWN = 2;
const ALIGNMENT_CENTER = 2;
const SHAPE_TYPE_RECTANGLE = 1;

/**
 * The document version claimed in `application_info`.
 *
 * Deliberately conservative: ProPresenter opens documents written by older
 * versions of itself, so claiming an old one is portable across every release
 * from 7 onwards. Claiming a version newer than the running app is not.
 */
const CLAIMED_VERSION = { major: 7, minor: 13, patch: 2 };

/** Default 1080p canvas. */
const DEFAULT_SLIDE_SIZE = { width: 1920, height: 1080 };

/**
 * Group colours, matched to ProPresenter's own conventions so an imported song
 * looks like a hand-built one. Keyed by the leading word of the section name.
 */
const GROUP_COLORS = {
  verse: { red: 0.27, green: 0.47, blue: 0.87 },
  chorus: { red: 0.85, green: 0.26, blue: 0.24 },
  'pre-chorus': { red: 0.95, green: 0.61, blue: 0.16 },
  prechorus: { red: 0.95, green: 0.61, blue: 0.16 },
  bridge: { red: 0.56, green: 0.35, blue: 0.79 },
  tag: { red: 0.2, green: 0.66, blue: 0.44 },
  ending: { red: 0.45, green: 0.45, blue: 0.45 },
  outro: { red: 0.45, green: 0.45, blue: 0.45 },
  intro: { red: 0.45, green: 0.45, blue: 0.45 },
  interlude: { red: 0.45, green: 0.45, blue: 0.45 },
  instrumental: { red: 0.45, green: 0.45, blue: 0.45 },
  refrain: { red: 0.85, green: 0.26, blue: 0.24 },
  vamp: { red: 0.2, green: 0.66, blue: 0.44 },
  repeat: { red: 0.2, green: 0.66, blue: 0.44 },
};

const FALLBACK_COLOR = { red: 0.4, green: 0.4, blue: 0.4 };

/** Pick a group colour from the section name, e.g. "Chorus 2" -> chorus red. */
export function groupColor(name) {
  const key = name.trim().toLowerCase().replace(/\s*\d+$/, '').replace(/\s*\(\d+\)$/, '');
  return GROUP_COLORS[key] ?? GROUP_COLORS[key.split(/\s+/)[0]] ?? FALLBACK_COLOR;
}

/** Default UUID source; overridable so tests can generate byte-identical files. */
function defaultUuid() {
  return globalThis.crypto.randomUUID().toUpperCase();
}

// ── leaf writers ─────────────────────────────────────────────────────────────

const uuidMsg = (value) => (w) => w.string(1, value);

const colorMsg = (c) => (w) => {
  w.float(1, c.red).float(2, c.green).float(3, c.blue).float(4, c.alpha ?? 1);
};

const sizeMsg = ({ width, height }) => (w) => w.double(1, width).double(2, height);
const pointMsg = ({ x, y }) => (w) => w.double(1, x).double(2, y);

const rectMsg = (rect) => (w) => {
  w.message(1, pointMsg({ x: rect.x, y: rect.y }));
  w.message(2, sizeMsg({ width: rect.width, height: rect.height }));
};

/**
 * A unit-space rectangle path, as ProPresenter writes for a text box.
 *
 * Every corner must be emitted even though the one at the origin encodes as an
 * empty message; a proto3 writer that skips empties would leave the rectangle
 * with three corners.
 */
const rectanglePath = () => (w) => {
  w.bool(1, true);
  for (const [x, y] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
    w.emptyableMessage(2, (p) => {
      p.emptyableMessage(1, pointMsg({ x, y }));
      p.emptyableMessage(2, pointMsg({ x, y }));
      p.emptyableMessage(3, pointMsg({ x, y }));
    });
  }
  w.message(3, (s) => s.enum(1, SHAPE_TYPE_RECTANGLE));
};

const fontMsg = (style) => (w) => {
  w.string(1, style.fontName ?? style.fontFamily);
  w.double(2, style.fontSize);
  w.bool(4, Boolean(style.italic));
  w.bool(8, Boolean(style.bold));
  w.string(9, style.fontFamily);
};

const textAttributesMsg = (style) => (w) => {
  w.message(1, fontMsg(style));
  w.message(3, colorMsg(style.color));
  w.message(6, (p) => p.enum(1, ALIGNMENT_CENTER));
};

const edgeInsetsMsg = (i) => (w) =>
  w.double(1, i.left).double(2, i.right).double(3, i.top).double(4, i.bottom);

// ── slide ────────────────────────────────────────────────────────────────────

function slideMsg(lines, options) {
  const { style, slideSize, margins, uuid } = options;
  return (w) => {
    // Slide.elements
    w.message(1, (el) => {
      // Slide.Element.element
      el.message(1, (g) => {
        g.message(1, uuidMsg(uuid()));
        g.string(2, 'Lyrics');
        g.message(3, rectMsg({
          x: 0,
          y: 0,
          width: slideSize.width,
          height: slideSize.height,
        }));
        g.double(5, 1); // opacity
        g.message(8, rectanglePath());
        g.message(9, (fill) => {
          fill.message(1, colorMsg({ red: 0, green: 0, blue: 0, alpha: 0 }));
          fill.bool(4, false);
        });
        // Graphics.Element.text
        g.message(13, (t) => {
          t.message(3, textAttributesMsg(style));
          t.bytes_(5, slideRtf(lines, style));
          t.enum(6, VERTICAL_ALIGNMENT_MIDDLE);
          t.enum(7, SCALE_BEHAVIOR_SCALE_FONT_DOWN);
          t.message(8, edgeInsetsMsg(margins));
        });
      });
    });
    w.message(6, sizeMsg(slideSize)); // Slide.size
    w.message(7, uuidMsg(uuid())); // Slide.uuid
  };
}

function cueMsg(lines, options) {
  const { uuid, label } = options;
  return (w) => {
    w.message(1, uuidMsg(options.cueUuid));
    w.bool(12, true); // isEnabled
    w.message(10, (action) => {
      action.message(1, uuidMsg(uuid()));
      action.string(2, label);
      action.bool(6, true); // isEnabled
      action.message(7, (layer) => {
        layer.message(1, uuidMsg(options.layerUuid));
        layer.string(2, 'Lyrics');
      });
      action.enum(9, ACTION_TYPE_PRESENTATION_SLIDE);
      // Action.slide -> SlideType.presentation -> PresentationSlide.base_slide
      action.message(23, (slideType) => {
        slideType.message(2, (presentationSlide) => {
          presentationSlide.message(1, slideMsg(lines, options));
        });
      });
    });
  };
}

/**
 * @typedef {object} BuildOptions
 * @property {string} [fontFamily]
 * @property {number} [fontSize]
 * @property {boolean} [bold]
 * @property {{red:number,green:number,blue:number}} [textColor]
 * @property {{width:number,height:number}} [slideSize]
 * @property {number} [margin]        Inset from the slide edge, in pixels.
 * @property {() => string} [uuid]    UUID source, for reproducible output.
 * @property {Date} [now]             Timestamp source, for reproducible output.
 */

/**
 * Build the `.pro` bytes for one laid-out song.
 *
 * @param {{title: string, key?: string|null, groups: {name: string, slides: string[][]}[], arrangement: string[]}} song
 * @param {BuildOptions} [options]
 * @returns {Uint8Array}
 */
export function buildPresentation(song, options = {}) {
  const uuid = options.uuid ?? defaultUuid;
  const now = options.now ?? new Date();
  const slideSize = options.slideSize ?? DEFAULT_SLIDE_SIZE;
  const margin = options.margin ?? 80;
  const style = {
    fontFamily: options.fontFamily ?? 'Arial',
    fontName: options.fontName,
    fontSize: options.fontSize ?? 64,
    bold: options.bold ?? true,
    italic: false,
    color: options.textColor ?? { red: 1, green: 1, blue: 1 },
    alignment: 'center',
  };
  const margins = { left: margin, right: margin, top: margin, bottom: margin };

  const layerUuid = uuid();

  // Each group owns its cues; the arrangement then references groups by uuid.
  const groups = song.groups.map((group) => {
    const groupUuid = uuid();
    // ProPresenter labels the *group*, not each slide, so cues stay unnamed -
    // repeating "Verse 1" under all four of its slides is noise.
    const cues = group.slides.map((lines) => ({ uuid: uuid(), lines, label: group.name }));
    return { ...group, groupUuid, cues };
  });

  const byName = new Map(groups.map((g) => [g.name, g]));
  const arrangementUuid = uuid();

  return encode((w) => {
    // application_info
    w.message(1, (info) => {
      info.enum(3, APPLICATION_PROPRESENTER);
      info.message(4, (v) => {
        v.uint(1, CLAIMED_VERSION.major);
        v.uint(2, CLAIMED_VERSION.minor);
        v.uint(3, CLAIMED_VERSION.patch);
      });
    });
    w.message(2, uuidMsg(uuid()));
    w.string(3, song.title);

    const seconds = Math.floor(now.getTime() / 1000);
    w.message(4, (t) => t.uint(1, seconds));
    w.message(5, (t) => t.uint(1, seconds));
    w.string(6, 'Song'); // category

    // background: disabled, so the document inherits the theme/look
    w.message(8, (bg) => {
      bg.message(1, colorMsg({ red: 0, green: 0, blue: 0, alpha: 1 }));
      bg.bool(3, false);
    });

    w.message(10, uuidMsg(arrangementUuid)); // selected_arrangement
    w.message(11, (arr) => {
      arr.message(1, uuidMsg(arrangementUuid));
      arr.string(2, 'Default');
      for (const name of song.arrangement) {
        const group = byName.get(name);
        if (group) arr.message(3, uuidMsg(group.groupUuid));
      }
    });

    // cue_groups
    for (const group of groups) {
      w.message(12, (cg) => {
        cg.message(1, (g) => {
          g.message(1, uuidMsg(group.groupUuid));
          g.string(2, group.name);
          g.message(3, colorMsg(groupColor(group.name)));
        });
        for (const cue of group.cues) cg.message(2, uuidMsg(cue.uuid));
      });
    }

    // cues
    for (const group of groups) {
      for (const cue of group.cues) {
        w.message(13, cueMsg(cue.lines, {
          cueUuid: cue.uuid,
          label: cue.label,
          layerUuid,
          uuid,
          style,
          slideSize,
          margins,
        }));
      }
    }

    // ccli
    w.message(14, (ccli) => {
      ccli.string(3, song.title);
      ccli.bool(7, false);
    });

    if (song.key) w.string(22, song.key); // music_key
  });
}

/** A filesystem-safe name for a song's `.pro` file. */
export function proFileName(song) {
  const base = [song.title, song.key ? `(${song.key})` : null]
    .filter(Boolean)
    .join(' ')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'Untitled'}.pro`;
}
