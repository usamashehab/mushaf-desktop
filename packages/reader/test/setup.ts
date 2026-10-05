import '@testing-library/jest-dom/vitest'

// jsdom has no font loading or layout; these stand-ins load every font at once and
// give every element a 1400×1000 box, so the reader draws as in a real window.

class FakeFontFace {
  family: string
  constructor(family: string) {
    this.family = family
  }
  load() {
    return Promise.resolve(this)
  }
}

class FakeResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1400, height: 1000 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

Object.assign(globalThis, { FontFace: FakeFontFace, ResizeObserver: FakeResizeObserver })
Object.defineProperty(document, 'fonts', { value: { add() {}, delete() {}, check: () => true } })

// The book turns its pages only when motion is welcome; the tests read the page reached.
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion: reduce'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia
