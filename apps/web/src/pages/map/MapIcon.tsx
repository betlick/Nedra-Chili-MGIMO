import type { CatId } from './data'

import { MAP_ICONS, type MapIconName } from './icons'
export { MAP_ICONS, type MapIconName }

export function MapIcon({ name, size = 18, sw = 1.8 }: { name: MapIconName | CatId; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={MAP_ICONS[name]} />
    </svg>
  )
}

/** Иконка внутри SVG-схемы: центр в (x, y), размер s. */
export function IconG({ name, x, y, s = 18, sw = 1.8 }: { name: MapIconName | CatId; x: number; y: number; s?: number; sw?: number }) {
  return (
    <path
      d={MAP_ICONS[name]}
      transform={`translate(${x - s / 2} ${y - s / 2}) scale(${s / 24})`}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  )
}
