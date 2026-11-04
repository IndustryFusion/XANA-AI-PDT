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

/**
 * Product mark: a neutral placeholder until a logo is chosen. Replace this
 * component to brand the application.
 */
export function ProductMark({ size = 32 }) {
  return (
    <svg className="product-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent-strong)" />
      <path d="M9 9l14 14M23 9L9 23" stroke="var(--accent-contrast)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand">
      <ProductMark />
      <span className="brand__text">
        <span className="brand__name">XANA AI PDT</span>
        <span className="brand__sub">Process Digital Twin</span>
      </span>
    </span>
  )
}
