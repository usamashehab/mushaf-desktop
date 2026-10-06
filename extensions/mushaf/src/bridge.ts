import { isHostMessage, MAX_STATE, type ExtensionMessage, type HostMessage, type Init } from './protocol.ts'

/** The extension's side of the messages with the app. */
export interface Bridge {
  init: Init
  send(message: ExtensionMessage): void
  /** A file of the extension's assets, from the app. */
  asset(path: string): Promise<ArrayBuffer>
  /** Places the user asked for after the start. */
  onOpen(listener: (place: string) => void): void
}

/**
 * Waits for the app's `init`, which brings the port every later message goes
 * over. Only a message from the frame's parent counts: the frame's own origin
 * is opaque, so the sender is known by its window, not its origin.
 */
export function connect(window: Window): Promise<Bridge> {
  return new Promise(resolve => {
    const onInit = (event: MessageEvent) => {
      const [port] = event.ports
      if (event.source !== window.parent || !port || !isHostMessage(event.data) || event.data.type !== 'init') {
        return
      }
      window.removeEventListener('message', onInit)
      resolve(bridge(event.data, port))
    }
    window.addEventListener('message', onInit)
  })
}

function bridge(init: Init, port: MessagePort): Bridge {
  const waiting = new Map<number, { resolve: (bytes: ArrayBuffer) => void; reject: (error: Error) => void }>()
  const opens: ((place: string) => void)[] = []
  let next = 1
  port.onmessage = (event: MessageEvent) => {
    if (!isHostMessage(event.data)) {
      return
    }
    const message: HostMessage = event.data
    if (message.type === 'asset') {
      const asked = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.bytes) {
        asked?.resolve(message.bytes)
      } else {
        asked?.reject(new Error('the app has no such file'))
      }
    } else if (message.type === 'open') {
      opens.forEach(listener => listener(message.place))
    }
  }
  const send = (message: ExtensionMessage) => {
    if (message.type === 'state' && JSON.stringify(message.data).length > MAX_STATE) {
      return
    }
    port.postMessage(message)
  }

  return {
    init,
    send,
    asset: path =>
      new Promise((resolve, reject) => {
        const id = next++
        waiting.set(id, { resolve, reject })
        send({ type: 'needAsset', id, path })
      }),
    onOpen: listener => {
      opens.push(listener)
    },
  }
}
