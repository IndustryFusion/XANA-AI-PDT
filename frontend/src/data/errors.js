/** Error kinds every data source uses when an operation fails. */
export const ERROR_KINDS = ['unavailable', 'not_found', 'conflict', 'invalid', 'unauthorized']

/**
 * The only error type screens see from the data interface.
 * `area` names the interface area, `kind` is one of ERROR_KINDS.
 */
export class DataError extends Error {
  constructor(area, kind, message) {
    super(message)
    this.name = 'DataError'
    this.area = area
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'unavailable'
  }
}

/** Wraps anything thrown by a data source into a DataError of that area. */
export function toDataError(area, err) {
  if (err instanceof DataError) return err
  return new DataError(area, 'unavailable', err?.message || 'The data source did not respond.')
}
