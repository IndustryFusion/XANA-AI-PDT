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
