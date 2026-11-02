/** Schemes accepted for service addresses. */
export const URL_SCHEMES = ['http', 'https', 'ws', 'wss', 'mqtt']

/** Why `value` is not a valid service address (checked with the browser's URL parser), or null. */
export function addressProblem(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'Enter an address.'
  let url
  try {
    url = new URL(text)
  } catch {
    return 'Not a valid URL, for example http://broker.example.org:9090.'
  }
  if (!URL_SCHEMES.includes(url.protocol.slice(0, -1))) return `Use one of the schemes ${URL_SCHEMES.join(', ')}.`
  if (!url.hostname) return 'The address has no host.'
  return null
}
