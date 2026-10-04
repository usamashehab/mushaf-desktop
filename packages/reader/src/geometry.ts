// A page's proportions, in em of the page font. One number, the font size, then
// sizes the whole page, so it scales to any window without reflowing a line.

/** Distance between lines. */
export const LINE_PITCH = 1.8
/** Room a full line gets over its glyphs' width: the word spaces, and the widest lines. */
export const LINE_SLACK = 1.06
export const LINES = 15
const PAD_X = 1.6
const PAD_Y = 1.1
const HEAD = 2
const FOOT = 2
/** Between facing pages. */
export const SPREAD_GAP = 1

export const textWidthEm = (lineEm: number) => lineEm * LINE_SLACK
export const pageWidthEm = (lineEm: number) => textWidthEm(lineEm) + 2 * PAD_X
export const pageHeightEm = () => LINES * LINE_PITCH + HEAD + FOOT + 2 * PAD_Y

export const PAGE_BOX = { padX: PAD_X, padY: PAD_Y, head: HEAD, foot: FOOT }

/**
 * The font size, in px, that fits `pages` facing pages into width × height,
 * times `zoom` (above 1 the page outgrows the window and scrolls).
 */
export function fitFontSize(options: { width: number; height: number; lineEm: number; pages: 1 | 2; zoom: number }): number {
  const { width, height, lineEm, pages, zoom } = options
  const across = pages * pageWidthEm(lineEm) + (pages - 1) * SPREAD_GAP
  const size = Math.min(width / across, height / pageHeightEm())

  return Math.max(6, Math.floor(size * zoom * 100) / 100)
}

/** Facing pages when the window is wide enough to show two at a useful size. */
export const prefersSpread = (width: number, height: number, lineEm: number) =>
  width / (2 * pageWidthEm(lineEm) + SPREAD_GAP) >= (height / pageHeightEm()) * 0.85
