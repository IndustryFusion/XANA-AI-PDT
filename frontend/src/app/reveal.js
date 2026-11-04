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

import { useEffect, useRef } from 'react'

const GAP = 12

/**
 * When `key` changes (another item was selected in the same area), scrolls
 * the page so the element's top shows just below the sticky header, if it
 * is hidden above it or far down the page. Nothing moves when it is already
 * in view, and nothing happens on first render.
 */
export function useRevealOnChange(ref, key) {
  const previous = useRef(key)
  useEffect(() => {
    if (previous.current === key) return
    previous.current = key
    const el = ref.current
    if (!el) return
    const offset = (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + GAP
    const { top } = el.getBoundingClientRect()
    if (top < offset || top > window.innerHeight - 80) window.scrollBy?.({ top: top - offset })
  }, [ref, key])
}
