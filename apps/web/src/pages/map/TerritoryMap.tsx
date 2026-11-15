import { memo, type RefObject } from 'react'
import { BUILDINGS, CAMPUSES, FORMS, plural, type Campus, type CampusId } from './data'
import { IconG } from './MapIcon'
import { press } from './helpers'

const TREES: [number, number][] = [[28,110],[28,170],[28,230],[28,290],[160,24],[250,22],[340,24],[430,24],[516,70],[516,130],[516,190],[516,250],[970,90],[970,150],[970,210],[970,270],[600,292],[700,284],[60,600],[120,560],[380,610],[300,470],[90,470],[960,640],[200,610],[960,380]]
const RIVER = 'M1030 312 C 880 318, 720 298, 612 322 C 540 338, 520 384, 528 444 C 536 520, 504 584, 474 670'

/* Всё, что не зависит от выбора: земля, река, дороги, деревья, остановки. Рисуется один раз. */
const Base = memo(function Base({ onBg }: { onBg: () => void }) {
  return (
    <>
      <defs>
        <filter id="cm-tsh" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1C1F29" floodOpacity=".14" />
        </filter>
      </defs>
      <rect x={-200} y={-200} width={1400} height={1040} fill="var(--cm-ground)" onClick={onBg} />
      <path d="M-10 410 C 120 394, 330 398, 446 424 C 492 470, 482 590, 440 660 L -10 660 Z" fill="var(--cm-park)" />
      <rect x={556} y={388} width={480} height={280} rx={44} fill="var(--cm-park)" />
      <text className="lbl muted" x={250} y={520} textAnchor="middle" fontSize={13} fontWeight={700}>Ботанический сад</text>
      <path d={RIVER} fill="none" stroke="var(--cm-water)" strokeWidth={40} strokeLinecap="round" />
      <path id="cm-riverlbl" d="M612 322 C 720 298, 880 318, 1030 312" fill="none" stroke="none" />
      <path d={RIVER} fill="none" stroke="var(--cm-water-hi)" strokeWidth={14} strokeLinecap="round" opacity={0.8} />
      <text className="lbl muted" fontSize={12} fontWeight={700} dy={4}>
        <textPath href="#cm-riverlbl" startOffset="52%" textAnchor="middle">река Тихая</textPath>
      </text>
      <rect x={-200} y={360} width={1400} height={24} fill="var(--cm-road)" />
      <rect x={538} y={-200} width={22} height={572} fill="var(--cm-road)" />
      {([[504, 357, 62, 3], [504, 384, 62, 3], [535, 300, 3, 52], [560, 300, 3, 52]] as const).map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={1.5} fill="var(--input-line)" opacity={0.55} />
      ))}
      <line x1={-200} x2={1200} y1={372} y2={372} stroke="var(--line-solid)" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
      <text className="lbl muted" x={250} y={376} textAnchor="middle" fontSize={11} fontWeight={700}>Академический проспект</text>
      <text className="lbl muted" textAnchor="middle" fontSize={11} fontWeight={700} transform="translate(553 160) rotate(-90)">Речная улица</text>
      {TREES.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8 + (i % 3) * 3} fill="var(--cm-tree)" />)}
      <g>
        <circle cx={118} cy={405} r={13} fill="var(--ink)" />
        <text className="ttl" x={118} y={410} textAnchor="middle" fontSize={12} style={{ fill: 'var(--bg)' }}>М</text>
        <text className="lbl" x={138} y={410} fontSize={12.5} fontWeight={800}>Университетская</text>
      </g>
      {([[300, 348], [770, 276], [760, 348]] as const).map(([x, y]) => (
        <g key={`${x}-${y}`} style={{ color: 'var(--ink)' }}>
          <circle cx={x} cy={y} r={11} fill="var(--hl)" stroke="var(--ink)" strokeWidth={1.5} />
          <IconG name="bus" x={x} y={y} s={13} />
        </g>
      ))}
      <g>
        <path d="M974 600 l-8 18 8-5 8 5z" fill="var(--ink-3)" />
        <text className="lbl muted" x={974} y={594} textAnchor="middle" fontSize={11} fontWeight={800}>С</text>
      </g>
    </>
  )
})

function Plot({ c, sel, soft, index, onPress }: { c: Campus; sel: boolean; soft: boolean; index: number; onPress: () => void }) {
  const { x, y, w, h } = c.plot
  const k = w / 1000
  const tw = Math.round(c.name.length * 9.4 + 36)
  const ly = c.label === 'top' ? y - 17 : y + h - 17
  return (
    <g
      role="button"
      tabIndex={0}
      className={`cm-plot${soft ? ' is-soft' : ''}`}
      aria-pressed={sel}
      data-c={c.id}
      style={{ ['--i' as string]: index }}
      aria-label={`${c.name}, ${c.addr}, ${plural(c.bs.length, FORMS.building)}.${sel ? ' Нажмите ещё раз, чтобы открыть карту кампуса.' : ''}`}
      {...press(onPress)}
    >
      <g className="cm-plot__lift">
        <rect
          className="cm-ring cm-shadow"
          x={x} y={y} width={w} height={h} rx={24}
          fill={sel ? 'color-mix(in oklab, var(--hl) 34%, var(--surface-solid))' : 'var(--surface-solid)'}
          stroke={sel ? 'var(--ink)' : 'var(--line-solid)'}
          strokeWidth={sel ? 3 : 1.5}
        />
        <g transform={`translate(${x} ${y}) scale(${k})`}>
          <rect x={30} y={303} width={940} height={44} rx={22} fill="var(--cm-ground)" />
          {c.bs.map((b) => {
            const bx = BUILDINGS[b].box
            return (
              <g key={b}>
                <rect x={bx.x} y={bx.y} width={bx.w} height={bx.h} rx={24} fill="color-mix(in oklab, var(--accent-solid) 30%, var(--surface-solid))" stroke="var(--line-solid)" strokeWidth={3} />
                <circle cx={bx.x + bx.w / 2} cy={bx.y + bx.h / 2} r={42} fill="var(--hl)" />
                <text className="ttl" x={bx.x + bx.w / 2} y={bx.y + bx.h / 2 + 15} textAnchor="middle" fontSize={42} style={{ fill: 'var(--on-hl)' }}>{b}</text>
              </g>
            )
          })}
        </g>
      </g>
      <rect className="cm-tag" x={x + w / 2 - tw / 2} y={ly} width={tw} height={34} rx={17} fill={sel ? 'var(--hl)' : 'var(--surface-solid)'} stroke={sel ? 'var(--ink)' : 'var(--line-solid)'} strokeWidth={1.5} />
      <text className="ttl" x={x + w / 2} y={ly + 22} textAnchor="middle" fontSize={13.5} style={sel ? { fill: 'var(--on-hl)' } : undefined}>{c.name}</text>
    </g>
  )
}

interface Props {
  svgRef: RefObject<SVGSVGElement | null>
  sel: CampusId | null
  onPick: (id: CampusId) => void
  onBg: () => void
}

export function TerritoryMap({ svgRef, sel, onPick, onBg }: Props) {
  return (
    <svg ref={svgRef} className="cm-svg" viewBox="0 0 1000 640" role="group" aria-label="Карта территории с тремя кампусами">
      <Base onBg={onBg} />
      {Object.values(CAMPUSES).map((c, i) => (
        <Plot key={c.id} c={c} index={i} sel={sel === c.id} soft={!!sel && sel !== c.id} onPress={() => onPick(c.id)} />
      ))}
    </svg>
  )
}
