import { useRef } from 'react'
import { render } from '@testing-library/react'
import { useRevealOnChange } from '../../src/app/reveal'

function Panel({ selected, top }) {
  const ref = useRef(null)
  useRevealOnChange(ref, selected)
  return (
    <div
      ref={(el) => {
        ref.current = el
        if (el) el.getBoundingClientRect = () => ({ top })
      }}
    />
  )
}

describe('useRevealOnChange', () => {
  beforeEach(() => { window.scrollBy = vi.fn() })
  afterEach(() => { delete window.scrollBy })

  test('does nothing on first render', () => {
    render(<Panel selected="a" top={-400} />)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  test('scrolls to the start of the panel when another item is selected and its top is hidden', () => {
    const { rerender } = render(<Panel selected="a" top={-400} />)
    rerender(<Panel selected="b" top={-400} />)
    expect(window.scrollBy).toHaveBeenCalledWith({ top: -400 - 12 })
  })

  test('leaves the page where it is when the panel is already in view', () => {
    const { rerender } = render(<Panel selected="a" top={120} />)
    rerender(<Panel selected="b" top={120} />)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })
})
