import type { ReactNode } from 'react'

/** Пометка текста, написанного ИИ. Цвет берёт от окружения, поэтому читается в любой теме и на любой карточке. */
export function AiMark({ children }: { children: ReactNode }) {
  return <span className="badge ai-mark">{children}</span>
}
