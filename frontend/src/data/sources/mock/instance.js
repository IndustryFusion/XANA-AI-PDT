/**
 * The mock source's single store and area implementations, shared by the
 * source's entry module and its development controls.
 */
import { createAreas } from './areas'
import { createStore } from './store'

export const store = createStore()
export const areas = createAreas(store)
export const { engine } = areas
