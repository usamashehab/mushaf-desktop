import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { PAGE_COUNT } from '@mushaf/core'

/** A turn from one page (or spread) to the next or the one before. */
interface Flip {
  dir: 1 | -1
  from: number[]
  to: number[]
  id: number
}

const FLIP_MS = 720

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The edge of a stack of pages: one hairline per few pages, up to `max`. */
function stack(share: number, side: 1 | -1, max = 9) {
  const lines = Math.round(1 + share * (max - 1))
  const shadows: string[] = []
  for (let i = 1; i <= lines; i++) {
    shadows.push(`${side * i}px ${i * 0.35}px 0 ${i % 2 ? 'var(--page-edge)' : 'var(--paper)'}`)
  }

  return shadows.join(', ')
}

interface BookProps {
  /** The page, or the two facing pages right first, to show. */
  pages: number[]
  renderPage: (page: number) => ReactNode
}

/**
 * The pages as an open book: a cover, a spine, the stacks of pages read and still to
 * read. Moving to the next page or spread turns the leaf over, right to left as a
 * Mushaf turns; jumping further just shows the new place.
 */
export function Book({ pages, renderPage }: BookProps) {
  const [flip, setFlip] = useState<Flip>()
  const last = useRef(pages)

  useEffect(() => {
    const from = last.current
    last.current = pages
    if (from.join() === pages.join()) {
      return
    }
    const step = from.length
    const dir = pages.length === step && pages[0] === (from[0] ?? 0) + step ? 1 : pages.length === step && pages[0] === (from[0] ?? 0) - step ? -1 : 0
    if (dir === 0 || prefersReducedMotion()) {
      setFlip(undefined)

      return
    }
    setFlip({ dir, from, to: pages, id: Date.now() })
  }, [pages])

  // animationend may never come (a hidden window, a test): end the turn on time anyway.
  useEffect(() => {
    if (!flip) {
      return
    }
    const timer = setTimeout(() => setFlip(current => (current?.id === flip.id ? undefined : current)), FLIP_MS + 120)

    return () => clearTimeout(timer)
  }, [flip])

  const isSpread = pages.length === 2
  const done = () => setFlip(undefined)
  // While turning, the slots show what lies under the leaf.
  let slots = pages
  let leaf: { front: number | undefined; back: number | undefined; kind: 'next' | 'prev' | 'in' } | undefined
  if (flip && isSpread) {
    const [fromRight, fromLeft] = flip.from as [number, number]
    const [toRight, toLeft] = flip.to as [number, number]
    slots = flip.dir === 1 ? [fromRight, toLeft] : [toRight, fromLeft]
    leaf = flip.dir === 1 ? { front: fromLeft, back: toRight, kind: 'next' } : { front: fromRight, back: toLeft, kind: 'prev' }
  } else if (flip) {
    slots = flip.dir === 1 ? flip.to : flip.from
    leaf = flip.dir === 1 ? { front: flip.from[0], back: undefined, kind: 'next' } : { front: flip.to[0], back: undefined, kind: 'in' }
  }

  // The slot the leaf uncovers as it turns: the left on going on, the right on going back.
  const revealed = !flip ? -1 : !isSpread ? 0 : flip.dir === 1 ? 1 : 0
  const first = pages[0] ?? 1
  const read = (first - 1) / (PAGE_COUNT - 1)
  const style = {
    '--flip-ms': `${FLIP_MS}ms`,
    // Pages read lie on the right, as a Mushaf opens; those to come on the left.
    '--stack-read': stack(read, 1),
    '--stack-left': stack(1 - read, -1),
  } as CSSProperties
  const spine = isSpread ? 'both' : first % 2 === 1 ? 'left' : 'right'

  return (
    <div className={`book${isSpread ? ' is-spread' : ' is-single'}`} style={style} data-spine={spine}>
      <div className="book-pages" dir="rtl">
        {slots.map((page, i) => (
          <div key={`slot-${i}`} className={`book-slot${flip && i === revealed ? ' is-under' : ''}`} data-side={isSpread ? (i === 0 ? 'right' : 'left') : spine}>
            {renderPage(page)}
          </div>
        ))}
        {flip && leaf ? (
          <div
            key={flip.id}
            className={`book-leaf is-${leaf.kind}${isSpread ? '' : ' is-whole'}`}
            onAnimationEnd={event => {
              if (event.target === event.currentTarget) {
                done()
              }
            }}
            aria-hidden="true"
          >
            <div className="book-face is-front">{leaf.front ? renderPage(leaf.front) : <div className="book-blank" />}</div>
            <div className="book-face is-back">{leaf.back ? renderPage(leaf.back) : <div className="book-blank" />}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
