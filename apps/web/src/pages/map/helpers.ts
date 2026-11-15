import type { KeyboardEvent, MouseEvent } from 'react'
import type { Campus } from './data'

export type VB = [number, number, number, number]
export const TERRITORY_VB: VB = [0, 0, 1000, 640]

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 759px)').matches

/** viewBox, при котором выбранный кампус заполняет карту. */
export function plotVB(c: Campus): VB {
  const { x, y, w, h } = c.plot
  const W = w + 40
  const H = W * 0.64
  return [x + w / 2 - W / 2, y + h / 2 - H / 2, W, H]
}

/** Плавное приближение: меняем viewBox напрямую, мимо React (60 кадров/с без перерисовки дерева). */
export function animateViewBox(svg: SVGSVGElement, from: VB, to: VB, ms: number, done?: () => void): () => void {
  if (reducedMotion()) {
    svg.setAttribute('viewBox', to.join(' '))
    done?.()
    return () => undefined
  }
  const t0 = performance.now()
  let raf = 0
  svg.classList.add('is-zooming')
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms)
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
    svg.setAttribute('viewBox', from.map((v, i) => (v + (to[i] - v) * e).toFixed(2)).join(' '))
    if (p < 1) raf = requestAnimationFrame(step)
    else {
      svg.classList.remove('is-zooming')
      done?.()
    }
  }
  svg.setAttribute('viewBox', from.join(' '))
  raf = requestAnimationFrame(step)
  return () => {
    cancelAnimationFrame(raf)
    svg.classList.remove('is-zooming')
  }
}

/** Нажатие и Enter/Space для SVG-групп с role="button". */
export function press(fn: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      fn()
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }
    },
  }
}

export function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length <= max) cur = (cur + ' ' + w).trim()
    else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Телефон: подвозит выбранный объект под шапку, чтобы нижняя шторка его не закрывала. */
export function ensureVisible(el: Element | null | undefined) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const top = 96
  if (r.top < top || r.bottom > window.innerHeight * 0.52) {
    window.scrollBy({ top: r.top - top, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
}
