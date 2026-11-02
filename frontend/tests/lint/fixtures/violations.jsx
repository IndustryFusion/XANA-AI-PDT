// Deliberate boundary violations, linted as if it were a screen.
import { session } from '../../data/sources/mock'

export async function load() {
  await fetch('/api/anything')
  return new WebSocket('ws://example.invalid') && session
}
