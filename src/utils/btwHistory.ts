/**
 * Session-scoped /btw history. Earlier side questions are shown above the
 * current one in the /btw panel and replayed as prior turns to the next side
 * question, so follow-ups ("and what about X?") have something to refer to.
 *
 * Leaf module: clearSessionCaches imports it at startup.
 */

export type BtwExchange = {
  question: string
  response: string
}

const MAX_EXCHANGES = 20

export class BtwHistory {
  exchanges: readonly BtwExchange[] = []

  replace(exchanges: readonly BtwExchange[]): void {
    this.exchanges = exchanges
  }

  append(question: string, response: string): void {
    this.exchanges = [...this.exchanges, { question, response }].slice(
      -MAX_EXCHANGES,
    )
  }
}

let history = new BtwHistory()

export function getBtwHistory(): BtwHistory {
  return history
}

export function resetBtwHistory(): void {
  history = new BtwHistory()
}
