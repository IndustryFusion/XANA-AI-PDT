//
// Copyright (c) 2026 IndustryFusion Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

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
