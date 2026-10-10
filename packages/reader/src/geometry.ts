// A page's proportions, in em of the page font. One number, the font size, then
// sizes the whole page, so it scales to any window without reflowing a line.

/** Distance between lines. */
export const LINE_PITCH = 1.8
/** Room a full line gets over its glyphs' width: the word spaces, and the widest lines. */
export const LINE_SLACK = 1.18
export const LINES = 15
const PAD_X = 2.1
const PAD_Y = 1.1
const HEAD = 2
const FOOT = 2
/** Between facing pages: none, they meet at the spine. */
export const SPREAD_GAP = 0
/** The cover round the pages, each side. */
export const COVER_X = 0.75
export const COVER_Y = 0.6
/** The stacks of page edges either side, in px at most. */
const STACK_PX = 12

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
  const across = pages * pageWidthEm(lineEm) + (pages - 1) * SPREAD_GAP + 2 * COVER_X
  const size = Math.min((width - 2 * STACK_PX) / across, (height - STACK_PX) / (pageHeightEm() + 2 * COVER_Y))

  return Math.max(6, Math.floor(size * zoom * 100) / 100)
}

/** Facing pages when the window is wide enough to show two at a useful size. */
export const prefersSpread = (width: number, height: number, lineEm: number) =>
  width / (2 * pageWidthEm(lineEm) + SPREAD_GAP) >= (height / pageHeightEm()) * 0.85
