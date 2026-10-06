import { describe, expect, test } from 'vitest'

import { connect } from '../src/bridge.ts'
import { isHostMessage, MAX_STATE, type ExtensionMessage, type Init } from '../src/protocol.ts'
import { startingSettings } from '../src/settings.ts'

const init: Init = { type: 'init', v: 1, state: null, language: 'en', theme: 'light' }

/** A frame's window: messages arrive as events, from its parent or from anyone else. */
function frame() {
  const target = new EventTarget()
  const parent = {}
  const window = Object.assign(target, { parent }) as unknown as Window
  const post = (data: unknown, ports: MessagePort[], source: unknown = parent) => {
    const event = new MessageEvent('message', { data, ports })
    Object.defineProperty(event, 'source', { value: source })
    target.dispatchEvent(event)
  }

  return { window, post }
}

/** The app's end of the port; what the extension sent over it. */
function host() {
  const channel = new MessageChannel()
  const sent: ExtensionMessage[] = []
  channel.port1.onmessage = event => sent.push(event.data as ExtensionMessage)

  return { channel, sent }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

describe('the bridge to the app', () => {
  test('starts only on an init from the parent, of this version, with a port', async () => {
    const { window, post } = frame()
    const { channel } = host()
    let started = false
    const bridge = connect(window).then(made => {
      started = true

      return made
    })
    post(init, [channel.port2], {})
    post({ ...init, v: 2 }, [channel.port2])
    post(init, [])
    await tick()
    expect(started).toBe(false)
    post(init, [channel.port2])
    expect((await bridge).init.language).toBe('en')
    channel.port1.close()
  })

  test('asks the app for a file and gets its bytes, or an error when it has none', async () => {
    const { window, post } = frame()
    const { channel, sent } = host()
    const bridge = connect(window)
    post(init, [channel.port2])
    const made = await bridge
    const font = made.asset('fonts/qcf-v2/p1.woff2')
    const missing = made.asset('fonts/none').catch((error: unknown) => error)
    await tick()
    expect(sent).toEqual([
      { type: 'needAsset', id: 1, path: 'fonts/qcf-v2/p1.woff2' },
      { type: 'needAsset', id: 2, path: 'fonts/none' },
    ])
    channel.port1.postMessage({ type: 'asset', id: 2, bytes: null })
    channel.port1.postMessage({ type: 'asset', id: 1, bytes: new ArrayBuffer(4) })
    expect((await font).byteLength).toBe(4)
    expect(await missing).toBeInstanceOf(Error)
    channel.port1.close()
  })

  test('passes on the page and the state to keep, but not a state too big to keep', async () => {
    const { window, post } = frame()
    const { channel, sent } = host()
    const bridge = connect(window)
    post(init, [channel.port2])
    const made = await bridge
    made.send({ type: 'page', page: 52, kind: 'turn' })
    made.send({ type: 'state', data: { page: 52 } })
    made.send({ type: 'state', data: 'x'.repeat(MAX_STATE) })
    await tick()
    expect(sent).toEqual([
      { type: 'page', page: 52, kind: 'turn' },
      { type: 'state', data: { page: 52 } },
    ])
    channel.port1.close()
  })

  test('places the app asks for reach the reader', async () => {
    const { window, post } = frame()
    const { channel } = host()
    const bridge = connect(window)
    post(init, [channel.port2])
    const made = await bridge
    const places: string[] = []
    made.onOpen(place => places.push(place))
    channel.port1.postMessage({ type: 'open', place: '2:255' })
    channel.port1.postMessage({ type: 'open', place: 5 })
    await tick()
    expect(places).toEqual(['2:255'])
    channel.port1.close()
  })

  test('only well-formed messages from the app are read', () => {
    expect(isHostMessage(init)).toBe(true)
    expect(isHostMessage({ ...init, language: 'fr' })).toBe(false)
    expect(isHostMessage({ type: 'asset', id: 1.5, bytes: null })).toBe(false)
    expect(isHostMessage({ type: 'eval', code: '1' })).toBe(false)
    expect(isHostMessage(null)).toBe(false)
  })
})

describe('the settings it starts from', () => {
  test('the ones kept, in the app\'s language', () => {
    const settings = startingSettings({ init: { state: { page: 77, theme: 'sepia', language: 'ar' }, language: 'en', theme: 'dark' } })
    expect(settings.page).toBe(77)
    expect(settings.language).toBe('en')
    expect(settings.theme).toBe('sepia')
  })

  test('at the first start, a dark app gives a night Mushaf', () => {
    expect(startingSettings({ init: { state: null, language: 'ar', theme: 'dark' } }).theme).toBe('night')
    expect(startingSettings({ init: { state: null, language: 'ar', theme: 'light' } }).theme).toBe('day')
  })
})
