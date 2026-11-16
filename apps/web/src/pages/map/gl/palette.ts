import { Color, SRGBColorSpace } from 'three'
import type { RoomCat } from '../data'

export interface Palette {
  ground: Color; road: Color; water: Color; park: Color; tree: Color
  surface: Color; body: Color; hl: Color; ink: Color; util: Color; plot: Color
  cat: Record<RoomCat, Color>; room: Record<RoomCat, Color>
  dark: boolean
}

/** Читает цвета темы из CSS-переменных. Любое CSS-значение (color-mix, oklch) превращается в sRGB через холст. */
export function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement('i')
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden'
  host.appendChild(probe)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  const col = (expr: string): Color => {
    probe.style.color = ''
    probe.style.color = expr
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = getComputedStyle(probe).color
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return new Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, SRGBColorSpace)
  }
  const cats: RoomCat[] = ['lecture', 'seminar', 'practice', 'food', 'cowork', 'sport', 'service', 'util']
  const dark = document.documentElement.dataset.theme === 'dark'
  const cat = {} as Record<RoomCat, Color>
  const room = {} as Record<RoomCat, Color>
  for (const k of cats) {
    cat[k] = col(`var(--cm-${k})`)
    room[k] = col(`color-mix(in oklab, var(--cm-${k}) ${k === 'util' ? 14 : dark ? 34 : 30}%, var(--surface-solid))`)
  }
  const p: Palette = {
    ground: col('var(--cm-ground)'),
    road: col('var(--cm-road)'),
    water: col('var(--cm-water)'),
    park: col('var(--cm-park)'),
    tree: col('var(--cm-tree)'),
    surface: col('var(--surface-solid)'),
    body: col(`color-mix(in oklab, var(--accent-solid) ${dark ? 40 : 26}%, var(--surface-solid))`),
    plot: col(`color-mix(in oklab, var(--accent-solid) ${dark ? 14 : 10}%, var(--surface-solid))`),
    hl: col('var(--hl)'),
    ink: col('var(--ink)'),
    util: col('var(--cm-util)'),
    cat,
    room,
    dark,
  }
  probe.remove()
  return p
}
