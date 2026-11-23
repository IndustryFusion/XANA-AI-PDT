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

import markDark from '../assets/brand/xana-mark-dark.png'
import markLight from '../assets/brand/xana-mark-light.png'
import wordmarkDark from '../assets/brand/xana-wordmark-dark.png'
import wordmarkLight from '../assets/brand/xana-wordmark-light.png'

export const PRODUCT_NAME = 'XANA AI PDT'
const WORDMARK_RATIO = 1536 / 260 // width / height of the "XANA AI" lettering

/**
 * One image per theme. CSS shows the one that matches the active theme
 * (app.css: .themed-img), so a theme change needs no re-render and the
 * system theme is followed without script. Both are decorative: the
 * wrapper carries the meaning.
 */
function ThemedImage({ light, dark, width, height }) {
  return (
    <>
      <img className="themed-img themed-img--dark" src={dark} width={width} height={height} alt="" decoding="async" />
      <img className="themed-img themed-img--light" src={light} width={width} height={height} alt="" decoding="async" />
    </>
  )
}

/** The XANA AI ring mark, without lettering. Decorative. */
export function ProductMark({ size = 32 }) {
  return (
    <span className="product-mark" aria-hidden="true">
      <ThemedImage light={markLight} dark={markDark} width={size} height={size} />
    </span>
  )
}

/** The "XANA AI" lettering, announced as the product name. */
export function Wordmark({ height = 16, label = PRODUCT_NAME }) {
  return (
    <span className="wordmark" role="img" aria-label={label}>
      <ThemedImage light={wordmarkLight} dark={wordmarkDark} width={Math.round(height * WORDMARK_RATIO)} height={height} />
    </span>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <ProductMark size={30} />
      <span className="brand__text">
        <Wordmark height={13} />
        <span className="brand__sub">Process Digital Twin</span>
      </span>
    </span>
  )
}
