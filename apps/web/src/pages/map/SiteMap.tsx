import { CATS, BUILDINGS, FORMS, ROOMS, plural, type BuildingId, type CatId, type Campus, type Room } from './data'
import { IconG } from './MapIcon'
import { press } from './helpers'

const TREES: [number, number][] = [[40,60],[70,110],[30,160],[60,215],[40,260],[920,40],[950,95],[925,150],[955,205],[930,255],[600,284],[400,284],[420,372],[590,372],[40,420],[60,480],[35,540],[950,420],[925,480],[955,545],[500,500],[500,560],[500,430],[220,600],[760,600],[330,604],[640,30],[260,30]]

interface Props {
  campus: Campus
  siteSel: BuildingId | null
  filtering: boolean
  match: (r: Room) => boolean
  onBuilding: (id: BuildingId) => void
  onMarker: (id: BuildingId, cat: CatId) => void
  onBg: () => void
}

/* Схема кампуса: корпусы с метками категорий. Нажатие на корпус выделяет его, повторное открывает планы этажей. */
export function SiteMap({ campus: c, siteSel, filtering, match, onBuilding, onMarker, onBg }: Props) {
  const boxes = c.bs.map((b) => BUILDINGS[b].box)
  const free = ([x, y]: [number, number]) =>
    !boxes.some((b) => x > b.x - 22 && x < b.x + b.w + 22 && y > b.y - 22 && y < b.y + b.h + 22) &&
    !(y > 288 && y < 362) &&
    !(y > 350 && y < 400 && x > 360 && x < 640) &&
    !(c.id === 'river' && y > 580) &&
    !c.bs.some((b) => {
      const [ex, ey] = BUILDINGS[b].entr
      return Math.abs(x - ex) < 30 && (y - 325) * (ey - 325) >= 0
    })
  const road = (x: number, y: number, w: number, h: number, key: string) => <rect key={key} x={x} y={y} width={w} height={h} rx={Math.min(w, h) / 2} fill="var(--cm-road)" />

  return (
    <svg className="cm-svg" viewBox="0 0 1000 640" role="group" aria-label={`Схема: ${c.name}`}>
      <defs>
        <filter id="cm-sh" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#1C1F29" floodOpacity=".16" />
        </filter>
      </defs>
      <rect width={1000} height={640} fill="var(--cm-ground)" onClick={onBg} />
      {c.id === 'river' && (
        <>
          <rect x={-10} y={596} width={1020} height={60} fill="var(--cm-water)" />
          <text className="lbl muted" x={500} y={624} textAnchor="middle" fontSize={12} fontWeight={700}>река Тихая</text>
        </>
      )}
      {road(30, 303, 940, 44, 'main')}
      {c.bs.map((b) => {
        const [x, y] = BUILDINGS[b].entr
        return road(x - 14, Math.min(y, 325), 28, Math.abs(y - 325), b)
      })}
      <line x1={60} x2={940} y1={325} y2={325} stroke="var(--line-solid)" strokeWidth={2} strokeDasharray="2 10" strokeLinecap="round" />
      {c.fountain ? (
        <>
          <circle cx={500} cy={325} r={36} fill="color-mix(in oklab, var(--accent-solid) 60%, var(--cm-road))" stroke="var(--accent-solid)" strokeWidth={3} />
          <circle className="cm-fountain" cx={500} cy={325} r={16} fill="var(--surface-solid)" opacity={0.7} />
        </>
      ) : (
        <circle cx={500} cy={325} r={30} fill="var(--cm-park)" stroke="var(--cm-tree)" strokeWidth={3} />
      )}
      {TREES.filter(free).map(([x, y], i) => <circle key={`${x}-${y}`} cx={x} cy={y} r={10 + (i % 3) * 3} fill="var(--cm-tree)" />)}
      <text className="lbl muted" x={500} y={380} textAnchor="middle" fontSize={12.5} fontWeight={700}>{c.feature}</text>
      <g style={{ color: 'var(--ink)' }}>
        <IconG name="gate" x={46} y={282} s={20} />
        <text className="lbl" x={46} y={268} textAnchor="middle" fontSize={12.5} fontWeight={800}>КПП</text>
      </g>
      <g style={{ color: 'var(--ink)' }}>
        <IconG name="bike" x={940} y={282} s={20} />
        <text className="lbl" x={940} y={268} textAnchor="middle" fontSize={12.5} fontWeight={800}>Велопарковка</text>
      </g>

      {c.bs.map((id, bi) => {
        const B = BUILDINGS[id]
        const { x, y, w, h } = B.box
        const sel = siteSel === id
        const dim = !!siteSel && !sel
        const [ex, ey] = B.entr
        const dir = ey < 325 ? 1 : -1
        const cats = CATS.filter((k) => ROOMS.some((r) => r.b === id && r.cat === k.id))
        const per = Math.floor((w - 48) / 58) + 1
        const rows = Math.ceil(cats.length / per)
        return (
          <g key={id} className={`cm-bld-wrap${dim ? ' is-soft' : ''}`} style={{ ['--i' as string]: bi }}>
            <g
              role="button"
              tabIndex={0}
              className="cm-bld"
              aria-pressed={sel}
              data-b={id}
              aria-label={`Корпус ${id}, ${B.name}, ${plural(B.floors, FORMS.floor)}.${sel ? ' Нажмите ещё раз, чтобы открыть планы этажей.' : ''}`}
              {...press(() => onBuilding(id))}
            >
              <g className="cm-bld__lift">
                <rect className="cm-ring cm-shadow" x={x} y={y} width={w} height={h} rx={22} fill={sel ? 'color-mix(in oklab, var(--hl) 30%, var(--surface-solid))' : 'var(--surface-solid)'} stroke={sel ? 'var(--ink)' : 'var(--line-solid)'} strokeWidth={sel ? 3 : 1.5} />
                <circle cx={x + 34} cy={y + 36} r={18} fill="var(--hl)" />
                <text className="ttl" x={x + 34} y={y + 42} textAnchor="middle" fontSize={16} style={{ fill: 'var(--on-hl)' }}>{id}</text>
                <text className="ttl" x={x + 62} y={y + 34} fontSize={15}>{B.name}</text>
                <text className="lbl muted" x={x + 62} y={y + 54} fontSize={12.5} fontWeight={600}>{plural(B.floors, FORMS.floor)}</text>
              </g>
            </g>
            <path d={`M${ex - 9} ${ey} l9 ${dir * 11} l9 ${-dir * 11}z`} fill="var(--hl)" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
            {cats.map((k, i) => {
              const row = Math.floor(i / per)
              const col = i % per
              const cx = x + 30 + col * 58
              const cy = y + h - 34 - (rows - 1 - row) * 54
              const total = ROOMS.filter((r) => r.b === id && r.cat === k.id).length
              const hit = ROOMS.filter((r) => r.b === id && r.cat === k.id && match(r)).length
              const mdim = filtering && !hit
              const n = filtering ? hit : total
              return (
                <g
                  key={k.id}
                  role="button"
                  tabIndex={0}
                  className={`cm-mark${mdim ? ' is-dim' : ''}`}
                  style={{ ['--i' as string]: i }}
                  aria-label={`${k.name} в корпусе ${id}: ${plural(n, FORMS.place)}. Открыть на плане этажа`}
                  {...press(() => onMarker(id, k.id))}
                >
                  <g className="cm-mark__pop">
                    <circle className="cm-ring" cx={cx} cy={cy} r={20} style={{ fill: `color-mix(in oklab, var(--cm-${k.id}) 26%, var(--surface-solid))`, stroke: `var(--cm-${k.id})` }} strokeWidth={2.5} />
                    <g style={{ color: 'var(--ink)' }}><IconG name={k.id} x={cx} y={cy} s={18} /></g>
                    <circle cx={cx + 15} cy={cy - 15} r={9.5} fill="var(--ink)" />
                    <text className="lbl" x={cx + 15} y={cy - 11} textAnchor="middle" fontSize={11} fontWeight={800} style={{ fill: 'var(--bg)' }}>{n}</text>
                  </g>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
