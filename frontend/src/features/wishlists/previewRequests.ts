import { getLinkPreview } from '../../api/client'
import type { LinkMetadata } from '../../api/types'

type Entry = {
  key: string; id: number; subscribers: number; started: boolean
  controller: AbortController; promise: Promise<LinkMetadata>
  resolve(data: LinkMetadata): void; reject(reason: unknown): void
}
const entries = new Map<string, Entry>()
const queue: Entry[] = []
let active = 0

function pump() {
  while (active < 2 && queue.length) {
    const entry = queue.shift()!
    entry.started = true
    active += 1
    void getLinkPreview(entry.id, entry.controller.signal).then(entry.resolve, entry.reject).finally(() => {
      active -= 1
      if (entries.get(entry.key) === entry) entries.delete(entry.key)
      pump()
    })
  }
}

export function subscribePreview(key: string, id: number): { promise: Promise<LinkMetadata>; release(): void } {
  let entry = entries.get(key)
  if (!entry) {
    let resolve!: Entry['resolve']
    let reject!: Entry['reject']
    const promise = new Promise<LinkMetadata>((yes, no) => { resolve = yes; reject = no })
    entry = { key, id, subscribers: 0, started: false, controller: new AbortController(), promise, resolve, reject }
    entries.set(key, entry)
    queue.push(entry)
  }
  const current = entry
  current.subscribers += 1
  pump()
  return {
    promise: current.promise,
    release() {
      current.subscribers -= 1
      // StrictMode can immediately resubscribe to the same in-flight request.
      queueMicrotask(() => {
        if (current.subscribers > 0) return
        current.controller.abort()
        if (!current.started) {
          const index = queue.indexOf(current)
          if (index >= 0) queue.splice(index, 1)
          if (entries.get(key) === current) entries.delete(key)
          current.reject(new DOMException('Preview cancelled', 'AbortError'))
        }
      })
    },
  }
}
