import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const USER_AGENT = 'mushaf-desktop-build-data'

async function download(url: string): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 2_000 * (attempt + 1)))
    }
  }
  throw new Error(`could not fetch ${url}: ${String(lastError)}`)
}

/** The file at `path`, downloading it from `url` first when it isn't there yet. */
export async function cached(url: string, path: string): Promise<Buffer> {
  if (existsSync(path)) {
    return readFile(path)
  }
  const body = await download(url)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)

  return body
}

export const cachedJson = async <T>(url: string, path: string): Promise<T> =>
  JSON.parse((await cached(url, path)).toString('utf8')) as T

export const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex')

/** Maps over `items` with at most `limit` calls running at once, keeping the order. */
export async function pool<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await map(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return out
}
