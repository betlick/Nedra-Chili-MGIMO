/* 3D-движок карты: ортографическая камера (изометрия), вращение/наклон/зум, подписи-кнопки поверх сцены.
   Один экземпляр на страницу: холст переезжает между уровнями, камера плавно меняет вид. */
import {
  AmbientLight, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, EdgesGeometry, ExtrudeGeometry,
  Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4,
  Mesh, MeshLambertMaterial, Object3D, OrthographicCamera, PCFSoftShadowMap, Quaternion, Raycaster, Scene, Shape,
  BufferGeometry, Spherical, TubeGeometry, Vector2, Vector3, WebGLRenderer, CurvePath, LineCurve3,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  BUILDINGS, CAMPUSES, CATS, ROOM, ROOMS, FORMS, plural, roomTitle,
  type BuildingId, type CampusId, type CatId, type RoomCat,
} from '../data'
import { MAP_ICONS, type MapIconName } from '../icons'
import { readPalette, type Palette } from './palette'
import { CORRIDOR, H as PH, BOT, TOP, PW, X0, layoutPlan, routePoints } from './plan'

/* ── состояния, которые задаёт React ── */
export type SceneState =
  | { level: 'territory'; sel: CampusId | null }
  | { level: 'campus'; campus: CampusId; sel: BuildingId | null; match: Set<string> | null }
  | { level: 'plan'; campus: CampusId; b: BuildingId; f: number; sel: string | null; match: Set<string> | null }

export interface Callbacks {
  campus: (id: CampusId) => void
  building: (id: BuildingId) => void
  marker: (b: BuildingId, cat: CatId) => void
  room: (id: string) => void
  bg: () => void
}
export type Intro = 'in' | 'none' | { campus: CampusId }

export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/* ── мелочи ── */
const S = 0.1 // 10 пикселей старой схемы = 1 единица мира
const wx = (px: number) => (px - 500) * S
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const BOX = new BoxGeometry(1, 1, 1)
const BOX_EDGES = new EdgesGeometry(BOX)
const FLOOR_H = 3.1
const DEFAULT_AZ = Math.PI / 4
const DEFAULT_POLAR = 0.93

const iconSvg = (name: MapIconName | CatId | RoomCat, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${MAP_ICONS[name as MapIconName]}"/></svg>`

function rrGeo(w: number, d: number, r: number, h: number): BufferGeometry {
  const x = -w / 2, y = -d / 2
  const s = new Shape()
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  const g = new ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 8 })
  g.rotateX(-Math.PI / 2)
  return g
}
/** Плоская фигура по точкам мира (x, z) с толщиной h. */
function flatGeo(pts: [number, number][], h: number): BufferGeometry {
  const s = new Shape()
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)))
  const g = new ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}
const bez = (p: number[][], t: number): [number, number] => {
  const u = 1 - t
  const f = (i: number) => u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i]
  return [f(0), f(1)]
}

/* ── то, что живёт в сцене ── */
interface Item {
  id: string
  group: Group
  mats: MeshLambertMaterial[]
  base: Color[]
  hl: Color
  lift: number
  sel: number; selT: number
  dim: number; dimT: number
  hover: number; hoverT: number
  grow: number; t0: number
  dimH: number
  selH: number
}
interface Pin {
  el: HTMLElement
  pos: Vector3
  key: string
}
interface Pickable { kind: 'campus' | 'building' | 'room'; id: string }

interface CamView { target: Vector3; az: number; pol: number; zoom: number }

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const isTouchy = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export class MapEngine {
  readonly host: HTMLDivElement
  cb: Callbacks = { campus() {}, building() {}, marker() {}, room() {}, bg() {} }
  onReady?: () => void

  private pinsEl: HTMLDivElement
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 1, 900)
  private controls: OrbitControls
  private light: DirectionalLight
  private amb: AmbientLight
  private hemi: HemisphereLight
  private world = new Group()
  private pal!: Palette
  private dispose: { dispose(): void }[] = []
  private items = new Map<string, Item>()
  private pins: Pin[] = []
  private pinMap = new Map<string, HTMLElement>()
  private picks: Mesh[] = []
  private ray = new Raycaster()
  private markers: { el: HTMLElement; b: BuildingId; cat: CatId; badge: HTMLElement; hit: number; total: number }[] = []
  private routeMesh: Mesh | null = null
  private routeT0 = 0
  private routeCount = 0

  private state: SceneState | null = null
  private key = ''
  private w = 1
  private h = 1
  private fit = 1
  private fitSize = { w: 100, d: 64 }
  private home: CamView = { target: new Vector3(), az: DEFAULT_AZ, pol: DEFAULT_POLAR, zoom: 8 }
  private tween: { t0: number; ms: number; from: CamView; to: CamView; done?: () => void } | null = null
  private shift = 0
  private shiftT = 0
  private raf = 0
  private dirty = true
  private last = 0
  private prevSel: string | null = null
  private down: { x: number; y: number; t: number; id: number } | null = null
  private hoverId: string | null = null
  private hoverRaf = 0
  private lost = false
  private ro: ResizeObserver
  private onScroll: () => void
  private mo: MutationObserver
  private attached = false
  private dead = false

  constructor() {
    this.host = document.createElement('div')
    this.host.className = 'cm-gl'
    this.pinsEl = document.createElement('div')
    this.pinsEl.className = 'cm-pins'
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    const cv = this.renderer.domElement
    cv.className = 'cm-gl__canvas'
    cv.setAttribute('aria-hidden', 'true')
    this.host.append(cv, this.pinsEl)

    this.amb = new AmbientLight(0xffffff, 1.0)
    this.hemi = new HemisphereLight(0xffffff, 0x8a93a6, 0.55)
    this.light = new DirectionalLight(0xffffff, 1.9)
    this.light.position.set(-38, 64, 30)
    this.light.castShadow = true
    const sc = this.light.shadow.camera
    sc.left = -82; sc.right = 82; sc.top = 82; sc.bottom = -82; sc.near = 5; sc.far = 220
    this.light.shadow.mapSize.set(isTouchy() ? 1024 : 2048, isTouchy() ? 1024 : 2048)
    this.light.shadow.bias = -0.0006
    this.light.shadow.normalBias = 0.06
    this.scene.add(this.amb, this.hemi, this.light, this.light.target, this.world)

    // колесо мыши масштабирует карту только с Ctrl/⌘ (или щипком на тачпаде): иначе страница не прокручивалась бы над картой
    cv.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation() }, { capture: true })
    this.controls = new OrbitControls(this.camera, cv)
    const c = this.controls
    c.enableDamping = !reduced()
    c.dampingFactor = 0.09
    c.rotateSpeed = 0.7
    c.zoomSpeed = 0.9
    c.screenSpacePanning = false
    c.panSpeed = 0.9
    c.minPolarAngle = 0.4
    c.maxPolarAngle = 1.28
    c.touches = { ONE: 0, TWO: 2 } // один палец вращает, два масштабируют и двигают
    if (isTouchy()) { c.minPolarAngle = DEFAULT_POLAR; c.maxPolarAngle = DEFAULT_POLAR } // на телефоне вертикальный свайп прокручивает страницу, наклон закреплён
    c.addEventListener('change', () => { this.clampTarget(); this.request() })

    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerleave', () => this.setHover(null))
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true })
    cv.addEventListener('webglcontextrestored', () => { this.lost = false; this.rebuild('none') })

    let scrollT = 0
    window.addEventListener('scroll', this.onScroll = () => { window.clearTimeout(scrollT); scrollT = window.setTimeout(() => this.refreshInset(), 160) }, { passive: true })
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.host)
    this.mo = new MutationObserver(() => this.retheme())
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-variant'] })
  }

  setCallbacks(cb: Callbacks) { this.cb = cb }

  /* ───────── подключение к странице ───────── */
  attach(parent: HTMLElement) {
    if (this.host.parentElement !== parent) parent.prepend(this.host)
    this.resize()
    if (!this.attached) {
      this.attached = true
      this.pal = readPalette(this.host)
      this.applyPalette()
      this.onReady?.()
    }
    this.request()
  }
  destroy() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('scroll', this.onScroll)
    this.ro.disconnect()
    this.mo.disconnect()
    this.clear()
    this.controls.dispose()
    this.renderer.dispose()
    this.host.remove()
  }

  /* ───────── размер и камера ───────── */
  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h || (w === this.w && h === this.h && this.attached)) return
    const ratio = this.camera.zoom / (this.fit || 1)
    this.w = w; this.h = h
    this.renderer.setSize(w, h, false)
    this.camera.left = -w / 2; this.camera.right = w / 2; this.camera.top = h / 2; this.camera.bottom = -h / 2
    this.fit = this.calcFit()
    this.home.zoom = this.fit
    this.camera.zoom = Math.min(this.fit * 5, Math.max(this.fit * 0.5, ratio * this.fit)) || this.fit
    this.controls.minZoom = this.fit * 0.55
    this.controls.maxZoom = this.fit * 5
    this.applyProjection()
    this.request()
  }
  private calcFit() {
    const R = Math.hypot(this.fitSize.w, this.fitSize.d) / 2
    const base = Math.max(2, Math.min(this.w / (2 * R * 1.0), this.h / (2 * R * 0.78)))
    // на узком экране сцену показываем крупнее экрана: края можно подвинуть двумя пальцами
    return this.w < 560 ? base * (this.state?.level === 'plan' ? 1.3 : 1.6) : base
  }
  private applyProjection() {
    if (this.shift > 0.5) this.camera.setViewOffset(this.w, this.h, 0, this.shift, this.w, this.h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }
  private clampTarget() {
    const t = this.controls.target
    const lx = this.fitSize.w / 2, lz = this.fitSize.d / 2
    t.x = Math.max(-lx, Math.min(lx, t.x))
    t.z = Math.max(-lz, Math.min(lz, t.z))
    t.y = 0
  }
  private getView(): CamView {
    const sp = new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))
    return { target: this.controls.target.clone(), az: sp.theta, pol: sp.phi, zoom: this.camera.zoom }
  }
  private setView(v: CamView) {
    const p = new Vector3().setFromSpherical(new Spherical(260, v.pol, v.az))
    this.controls.target.copy(v.target)
    this.camera.position.copy(v.target).add(p)
    this.camera.zoom = v.zoom
    this.camera.lookAt(v.target)
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }
  /** Плавный перелёт камеры. */
  flyTo(to: Partial<CamView>, ms = 520, done?: () => void) {
    const from = this.getView()
    const full: CamView = {
      target: to.target ?? from.target, az: to.az ?? from.az, pol: to.pol ?? from.pol, zoom: to.zoom ?? from.zoom,
    }
    if (reduced() || ms <= 0) {
      this.setView(full)
      done?.()
      this.request()
      return
    }
    // вращение по кратчайшему пути
    let d = full.az - from.az
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    full.az = from.az + d
    this.controls.enabled = false
    this.tween = { t0: performance.now(), ms, from, to: full, done }
    this.request()
  }
  reset() { this.flyTo(this.home, 560) }
  rotate(dir: 1 | -1) {
    const v = this.getView()
    this.flyTo({ az: Math.round((v.az + (dir * Math.PI) / 4) / (Math.PI / 4)) * (Math.PI / 4) }, 420)
  }
  zoomBy(k: number) {
    const v = this.getView()
    this.flyTo({ zoom: Math.min(this.fit * 5, Math.max(this.fit * 0.55, v.zoom * k)) }, 300)
  }
  /** Телефон: сдвигает картинку вверх, чтобы выбранное не пряталось под нижней шторкой. */
  setInset(px: number) {
    this.shiftT = px
    this.request()
  }
  /** Телефон: нижняя шторка закрывает часть карты. Сдвигаем картинку так, чтобы центр сцены оказался в видимой части. */
  refreshInset() {
    if (this.dead) return
    const phone = matchMedia('(max-width: 759px)').matches
    const sheet = phone ? document.querySelector<HTMLElement>('.cm-pop, .cm-info:not(.cm-info--empty)') : null
    if (!sheet || !this.attached) return this.setInset(0)
    const r = this.host.getBoundingClientRect()
    const top = Math.max(r.top, 84)
    const bottom = Math.min(r.bottom, sheet.getBoundingClientRect().top)
    if (bottom - top < 120) return this.setInset(0)
    this.setInset(Math.max(0, Math.min(this.h * 0.45, r.top + r.height / 2 - (top + bottom) / 2)))
  }
  /** Приближение к кампусу перед переходом на его карту. */
  dive(id: CampusId, done: () => void) {
    const c = CAMPUSES[id].plot
    const target = new Vector3(wx(c.x + c.w / 2), 0, (c.y + c.h / 2 - 320) * S)
    this.flyTo({ target, zoom: this.camera.zoom * 2.4 }, 560, done)
  }

  /* ───────── заданное состояние ───────── */
  set(state: SceneState, intro: Intro = 'none') {
    const key = state.level === 'territory' ? 't' : state.level === 'campus' ? `c-${state.campus}` : `p-${state.b}-${state.f}`
    this.state = state
    if (key !== this.key) {
      this.key = key
      this.rebuild(intro)
    } else {
      this.applyState(true)
    }
  }

  private rebuild(intro: Intro) {
    if (!this.state || !this.attached) return
    this.clear()
    const s = this.state
    const pal = this.pal
    if (s.level === 'territory') this.buildTerritory(pal, s)
    else if (s.level === 'campus') this.buildCampus(pal, s)
    else this.buildPlan(pal, s)
    this.fit = this.calcFit()
    this.controls.minZoom = this.fit * 0.55
    this.controls.maxZoom = this.fit * 5
    this.home = { target: new Vector3(0, 0, 0), az: DEFAULT_AZ, pol: DEFAULT_POLAR, zoom: this.fit }
    if (s.level === 'plan') this.home.target.set(0, 0, 0)
    this.prevSel = null
    this.applyState(false)
    const t0 = performance.now()
    for (const it of this.items.values()) {
      it.t0 = t0 + (reduced() ? -999 : it.t0)
    }
    if (intro === 'none' || reduced()) {
      this.setView(this.home)
    } else if (intro === 'in') {
      this.setView({ ...this.home, az: this.home.az + 0.7, zoom: this.home.zoom * 0.78 })
      this.flyTo(this.home, 780)
    } else {
      const c = CAMPUSES[intro.campus].plot
      this.setView({ ...this.home, target: new Vector3(wx(c.x + c.w / 2), 0, (c.y + c.h / 2 - 320) * S), zoom: this.home.zoom * 2.4 })
      this.flyTo(this.home, 620)
    }
    this.host.classList.remove('cm-gl--in')
    void this.host.offsetWidth
    this.host.classList.add('cm-gl--in')
    this.request()
  }

  private retheme() {
    if (!this.attached || this.dead) return
    // смена темы идёт в несколько атрибутов подряд: ждём кадр, потом перекрашиваем
    requestAnimationFrame(() => {
      this.pal = readPalette(this.host)
      this.applyPalette()
      if (this.state) { const v = this.getView(); this.rebuildKeep(v) }
    })
  }
  private rebuildKeep(v: CamView) {
    const keep = this.tween
    this.rebuild('none')
    if (!keep) this.setView(v)
  }
  private applyPalette() {
    const p = this.pal
    this.renderer.setClearColor(p.ground)
    const d = p.dark
    this.amb.intensity = d ? 0.85 : 1.0
    this.hemi.intensity = d ? 0.42 : 0.55
    this.hemi.groundColor.set(d ? 0x1a1c26 : 0x8a93a6)
    this.light.intensity = d ? 1.7 : 1.9
  }

  /* ───────── очистка ───────── */
  private clear() {
    this.world.clear()
    for (const d of this.dispose) d.dispose()
    this.dispose = []
    this.items.clear()
    this.picks = []
    this.markers = []
    this.routeMesh = null
    for (const p of this.pins) p.el.remove()
    this.pins = []
    this.pinMap.clear()
    this.hoverId = null
  }
  private track<T extends { dispose(): void }>(o: T): T { this.dispose.push(o); return o }
  private mat(c: Color): MeshLambertMaterial { return this.track(new MeshLambertMaterial({ color: c.clone() })) }

  /* ───────── строительные блоки ───────── */
  private slab(geo: BufferGeometry, c: Color, x: number, y: number, z: number, cast = false): Mesh {
    const m = new Mesh(this.track(geo), this.mat(c))
    m.position.set(x, y, z)
    m.receiveShadow = true
    m.castShadow = cast
    this.world.add(m)
    return m
  }
  private plane(c: Color, w: number, d: number, x: number, z: number, y: number, h = 0.06): Mesh {
    const m = new Mesh(BOX, this.mat(c))
    m.scale.set(w, h, d)
    m.position.set(x, y + h / 2, z)
    m.receiveShadow = true
    this.world.add(m)
    return m
  }
  /** Объём, который растёт из земли; возвращает элемент для подсветки. */
  private block(id: string, o: { w: number; h: number; d: number; x: number; z: number; y?: number; color: Color; outline?: boolean; pick?: Pickable; delay?: number; lift?: number; dimH?: number; selH?: number; floors?: number }): Item {
    const g = new Group()
    g.position.set(o.x, o.y ?? 0, o.z)
    const mats: MeshLambertMaterial[] = []
    const floors = o.floors ?? 1
    const fh = o.h / floors
    for (let i = 0; i < floors; i++) {
      const m = this.mat(o.color)
      mats.push(m)
      const gap = floors > 1 ? 0.07 : 0
      const mesh = new Mesh(BOX, m)
      mesh.scale.set(o.w - (i < floors - 1 ? gap : 0), fh - (floors > 1 ? 0.09 : 0), o.d - (i < floors - 1 ? gap : 0))
      mesh.position.y = i * fh + (fh - (floors > 1 ? 0.09 : 0)) / 2
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (o.outline) {
        const e = new LineSegments(BOX_EDGES, this.track(new LineBasicMaterial({ color: this.pal.ink, transparent: true, opacity: this.pal.dark ? 0.22 : 0.26 })))
        mesh.add(e)
      }
      if (o.pick) {
        mesh.userData = o.pick
        this.picks.push(mesh)
      }
      g.add(mesh)
    }
    this.world.add(g)
    const it: Item = {
      id, group: g, mats, base: mats.map((m) => m.color.clone()), hl: this.pal.hl, lift: o.lift ?? 0,
      sel: 0, selT: 0, dim: 0, dimT: 0, hover: 0, hoverT: 0, grow: 0, t0: o.delay ?? 0, dimH: o.dimH ?? 1, selH: o.selH ?? 1,
    }
    g.scale.y = 0.001
    this.items.set(id, it)
    return it
  }
  private tree(list: [number, number][], tint: Color) {
    const geo = this.track(new IcosahedronGeometry(1, 1))
    const m = this.mat(tint)
    const im = new InstancedMesh(geo, m, list.length)
    const mx = new Matrix4(), q = new Quaternion(), sc = new Vector3(), pos = new Vector3()
    list.forEach(([x, z], i) => {
      const r = 0.9 + ((i * 7) % 3) * 0.32
      pos.set(x, r * 0.95, z)
      sc.set(r, r * 1.15, r)
      mx.compose(pos, q, sc)
      im.setMatrixAt(i, mx)
    })
    im.castShadow = true
    im.receiveShadow = true
    this.world.add(im)
  }
  private pin(o: { key: string; pos: Vector3; html: string; cls?: string; label?: string; click?: () => void; delay?: number }): HTMLElement {
    const el = document.createElement(o.click ? 'button' : 'div')
    el.className = `cm-pin ${o.cls ?? ''}`
    el.dataset.k = o.key
    el.innerHTML = o.html
    if (o.click) {
      ;(el as HTMLButtonElement).type = 'button'
      el.setAttribute('aria-label', o.label ?? '')
      el.addEventListener('click', (e) => { e.stopPropagation(); o.click!() })
    } else {
      el.setAttribute('aria-hidden', 'true')
    }
    el.style.setProperty('--i', String(this.pins.length))
    if (o.delay != null) el.style.setProperty('--d', `${o.delay}ms`)
    this.pinsEl.appendChild(el)
    this.pins.push({ el, pos: o.pos, key: o.key })
    this.pinMap.set(o.key, el)
    return el
  }

  /* ───────── территория ───────── */
  private buildTerritory(p: Palette, s: Extract<SceneState, { level: 'territory' }>) {
    this.fitSize = { w: 100, d: 64 }
    const z = (py: number) => (py - 320) * S
    // земля, парки, река, дороги
    this.plane(p.ground, 420, 320, 0, 0, -0.4, 0.4)
    const parkL: [number, number][] = []
    const seg = (a: number[][]) => { for (let i = 0; i <= 10; i++) parkL.push(bez(a, i / 10).map((v, k) => (k ? z(v) : wx(v))) as [number, number]) }
    parkL.push([wx(-10), z(410)])
    seg([[-10, 410], [120, 394], [330, 398], [446, 424]])
    seg([[446, 424], [492, 470], [482, 590], [440, 660]])
    parkL.push([wx(-10), z(660)])
    this.slab(flatGeo(parkL, 0.06), p.park, 0, 0, 0)
    this.slab(rrGeo(48, 28, 4.4, 0.06), p.park, wx(796), 0, z(528))
    // река
    const R = [[[1030, 312], [880, 318], [720, 298], [612, 322]], [[612, 322], [540, 338], [520, 384], [528, 444]], [[528, 444], [536, 520], [504, 584], [474, 670]]]
    const line: [number, number][] = []
    R.forEach((c) => { for (let i = 0; i <= 14; i++) line.push(bez(c, i / 14)) })
    const L: [number, number][] = [], Rr: [number, number][] = []
    line.forEach((pt, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)]
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len
      L.push([wx(pt[0] + nx * 20), z(pt[1] + ny * 20)])
      Rr.push([wx(pt[0] - nx * 20), z(pt[1] - ny * 20)])
    })
    this.slab(flatGeo([...L, ...Rr.reverse()], 0.04), p.water, 0, 0.0, 0)
    // дороги (поверх реки: мост)
    this.plane(p.road, 420, 2.4, 0, z(372), 0.05, 0.12)
    this.plane(p.road, 2.2, 57.2, wx(549), z(86), 0.05, 0.12)
    // деревья
    const plots = Object.values(CAMPUSES).map((c) => c.plot)
    const trees = ([[28,110],[28,170],[28,230],[28,290],[160,24],[250,22],[340,24],[430,24],[516,70],[516,130],[516,190],[516,250],[970,90],[970,150],[970,210],[970,270],[600,292],[700,284],[60,600],[120,560],[380,610],[300,470],[90,470],[960,640],[200,610],[960,380]] as [number, number][])
      .filter(([x, y]) => !plots.some((q) => x > q.x - 14 && x < q.x + q.w + 14 && y > q.y - 14 && y < q.y + q.h + 14))
      .map(([x, y]) => [wx(x), z(y)] as [number, number])
    this.tree(trees, p.tree)

    // кампусы: площадка + уменьшенные корпуса
    Object.values(CAMPUSES).forEach((c, i) => {
      const { x, y, w, h } = c.plot
      const k = w / 1000
      const cx = wx(x + w / 2), cz = z(y + h / 2)
      const padH = 0.5
      const pad = new Group()
      pad.position.set(cx, 0, cz)
      const mat = this.mat(p.plot)
      const edge = this.mat(p.ink)
      const ring = new Mesh(this.track(rrGeo(w * S + 0.5, h * S + 0.5, 2.6, 0.3)), edge)
      ring.position.y = 0.04
      ring.visible = false
      const padMesh = new Mesh(this.track(rrGeo(w * S, h * S, 2.4, padH)), mat)
      padMesh.position.y = 0.1
      padMesh.castShadow = true
      padMesh.receiveShadow = true
      padMesh.userData = { kind: 'campus', id: c.id } satisfies Pickable
      this.picks.push(padMesh)
      pad.add(ring, padMesh)
      this.world.add(pad)
      const it: Item = {
        id: c.id, group: pad, mats: [mat], base: [mat.color.clone()], hl: new Color().copy(p.hl).lerp(p.surface, 0.35), lift: 0.7,
        sel: 0, selT: 0, dim: 0, dimT: 0, hover: 0, hoverT: 0, grow: 0, t0: i * 110, dimH: 1, selH: 1,
      }
      it.group.userData.ring = ring
      pad.scale.y = 0.001
      this.items.set(c.id, it)

      let tall = 0
      c.bs.forEach((id, bi) => {
        const B = BUILDINGS[id]
        const bw = B.box.w * k * S, bd = B.box.h * k * S, bh = B.floors * 2.3
        tall = Math.max(tall, bh)
        const bx = wx(x + B.box.x * k + (B.box.w * k) / 2), bz = z(y + B.box.y * k + (B.box.h * k) / 2)
        const blk = this.block(`${c.id}:${id}`, { w: bw, h: bh, d: bd, x: bx, z: bz, y: padH + 0.1, color: p.body, pick: { kind: 'campus', id: c.id }, delay: i * 110 + 160 + bi * 70, floors: B.floors })
        blk.lift = 0
        this.pin({ key: `b:${c.id}:${id}`, pos: new Vector3(bx, padH + 0.1 + bh + 0.2, bz), html: `<i>${id}</i>`, cls: 'cm-pin--letter' })
      })
      const top = c.label === 'top'
      const lz = top ? z(y) - 1.2 : z(y + h) + 1.2
      this.pin({
        key: `campus:${c.id}`, pos: new Vector3(cx, 0.9, lz), cls: 'cm-pin--tag', delay: 200 + i * 110,
        html: `<span>${c.name}</span>`, label: `${c.name}, ${c.addr}, ${plural(c.bs.length, FORMS.building)}`, click: () => this.cb.campus(c.id),
      })
    })
    // подписи и остановки
    this.pin({ key: 'metro', pos: new Vector3(wx(118), 0.3, z(405)), cls: 'cm-pin--metro', html: '<i>М</i><span>Университетская</span>' })
    ;([[300, 348], [770, 276], [760, 348]] as const).forEach(([x, y], i) => this.pin({ key: `bus${i}`, pos: new Vector3(wx(x), 0.3, z(y)), cls: 'cm-pin--bus', html: iconSvg('bus', 14) }))
    this.pin({ key: 'garden', pos: new Vector3(wx(250), 0.3, z(520)), cls: 'cm-pin--text', html: 'Ботанический сад' })
    this.pin({ key: 'river', pos: new Vector3(wx(860), 0.3, z(311)), cls: 'cm-pin--text', html: 'река Тихая' })
    this.pin({ key: 'prosp', pos: new Vector3(wx(250), 0.3, z(376)), cls: 'cm-pin--text', html: 'Академический проспект' })
    this.state = s
  }

  /* ───────── кампус ───────── */
  private buildCampus(p: Palette, s: Extract<SceneState, { level: 'campus' }>) {
    this.fitSize = { w: 100, d: 64 }
    const c = CAMPUSES[s.campus]
    const z = (py: number) => (py - 320) * S
    this.plane(p.ground, 420, 320, 0, 0, -0.4, 0.4)
    if (c.id === 'river') {
      this.plane(p.water, 420, 20, 0, z(626), 0.0, 0.1)
      this.pin({ key: 'riv', pos: new Vector3(0, 0.3, z(624)), cls: 'cm-pin--text', html: 'река Тихая' })
    }
    this.plane(p.road, 94, 4.4, 0, z(325), 0.0, 0.1)
    c.bs.forEach((b) => {
      const [x, y] = BUILDINGS[b].entr
      const len = Math.abs(y - 325) * S
      this.plane(p.road, 2.8, len, wx(x), z((y + 325) / 2), 0.0, 0.1)
    })
    // фонтан или сквер
    if (c.fountain) {
      const ring = new Mesh(this.track(new CylinderGeometry(3.6, 3.7, 0.4, 40)), this.mat(new Color().copy(p.road).lerp(p.water, 0.7)))
      ring.position.set(0, 0.25, z(325)); ring.receiveShadow = true; ring.castShadow = true
      const inner = new Mesh(this.track(new CylinderGeometry(2.7, 2.7, 0.45, 40)), this.mat(p.water))
      inner.position.set(0, 0.3, z(325))
      const jet = new Mesh(this.track(new ConeGeometry(0.5, 2.2, 14)), this.mat(p.surface))
      jet.position.set(0, 1.5, z(325)); jet.castShadow = true
      this.world.add(ring, inner, jet)
    } else {
      const sq = new Mesh(this.track(new CylinderGeometry(3, 3, 0.2, 36)), this.mat(p.park))
      sq.position.set(0, 0.2, z(325)); sq.receiveShadow = true
      this.world.add(sq)
    }
    // деревья
    const boxes = c.bs.map((b) => BUILDINGS[b].box)
    const free = ([x, y]: [number, number]) =>
      !boxes.some((b) => x > b.x - 22 && x < b.x + b.w + 22 && y > b.y - 22 && y < b.y + b.h + 22) &&
      !(y > 288 && y < 362) && !(y > 350 && y < 400 && x > 360 && x < 640) && !(c.id === 'river' && y > 580) &&
      !c.bs.some((b) => { const [ex, ey] = BUILDINGS[b].entr; return Math.abs(x - ex) < 30 && (y - 325) * (ey - 325) >= 0 })
    const T: [number, number][] = [[40,60],[70,110],[30,160],[60,215],[40,260],[920,40],[950,95],[925,150],[955,205],[930,255],[600,284],[400,284],[420,372],[590,372],[40,420],[60,480],[35,540],[950,420],[925,480],[955,545],[500,500],[500,560],[500,430],[220,600],[760,600],[330,604],[640,30],[260,30]]
    this.tree(T.filter(free).map(([x, y]) => [wx(x), z(y)]), p.tree)
    // корпуса
    c.bs.forEach((id, bi) => {
      const B = BUILDINGS[id]
      const bw = B.box.w * S, bd = B.box.h * S, bh = B.floors * FLOOR_H
      const cx = wx(B.box.x + B.box.w / 2), cz = z(B.box.y + B.box.h / 2)
      this.block(`b:${id}`, { w: bw, h: bh, d: bd, x: cx, z: cz, color: p.body, pick: { kind: 'building', id }, delay: bi * 120, lift: 0.9, floors: B.floors })
      this.pin({
        key: `b:${id}`, pos: new Vector3(cx, bh + 7.2, cz - bd * 0.12), cls: 'cm-pin--bld', delay: 260 + bi * 120,
        html: `<i>${id}</i><b>${B.name}</b>`, label: `Корпус ${id}, ${B.name}, ${plural(B.floors, FORMS.floor)}`, click: () => this.cb.building(id),
      })
      // вход
      const [ex, ey] = B.entr
      const cone = new Mesh(this.track(new ConeGeometry(0.9, 1.6, 4)), this.mat(p.hl))
      cone.rotation.x = Math.PI
      cone.position.set(wx(ex), 1.6, z(ey) + (ey < 325 ? 1.4 : -1.4))
      cone.castShadow = true
      this.world.add(cone)
      // метки категорий: один ряд вдоль переднего края крыши
      const cats = CATS.filter((k) => ROOMS.some((r) => r.b === id && r.cat === k.id))
      const step = cats.length > 1 ? Math.min(6.2, (bw - 6) / (cats.length - 1)) : 0
      cats.forEach((k, i) => {
        const total = ROOMS.filter((r) => r.b === id && r.cat === k.id).length
        const el = this.pin({
          key: `m:${id}:${k.id}`, pos: new Vector3(cx + (i - (cats.length - 1) / 2) * step, bh + 0.15, cz + bd * 0.24), cls: 'cm-pin--mark', delay: 420 + bi * 120 + i * 40,
          html: `${iconSvg(k.id, 14)}<em></em>`, label: '', click: () => this.cb.marker(id, k.id),
        })
        el.style.setProperty('--c', `var(--cm-${k.id})`)
        this.markers.push({ el, b: id, cat: k.id, badge: el.querySelector('em')!, hit: total, total })
      })
    })
    this.pin({ key: 'kpp', pos: new Vector3(wx(46), 0.4, z(282)), cls: 'cm-pin--poi', html: `${iconSvg('gate', 16)}<span>КПП</span>` })
    this.pin({ key: 'bike', pos: new Vector3(wx(940), 0.4, z(282)), cls: 'cm-pin--poi', html: `${iconSvg('bike', 16)}<span>Велопарковка</span>` })
    this.pin({ key: 'feat', pos: new Vector3(0, 0.4, z(385)), cls: 'cm-pin--text', html: c.feature })
  }

  /* ───────── план этажа ───────── */
  private buildPlan(p: Palette, s: Extract<SceneState, { level: 'plan' }>) {
    const { b, f } = s
    const cy = 265
    const z = (py: number) => (py - cy) * S
    const slots = layoutPlan(b, f)
    const totalD = (BOT + PH - TOP) * S
    this.fitSize = { w: PW * S + 12, d: totalD + 26 }
    this.plane(p.ground, 420, 320, 0, 0, -0.4, 0.4)
    const sw = PW * S + 1.6, sd = totalD + 1.6
    const ink = this.slab(rrGeo(sw + 0.5, sd + 0.5, 2.2, 0.5), p.ink, 0, 0, z((TOP + BOT + PH) / 2))
    ink.castShadow = true
    this.slab(rrGeo(sw, sd, 2, 0.62), p.road, 0, 0, z((TOP + BOT + PH) / 2))
    // пунктир коридора
    for (let x = X0 + 20; x < X0 + PW - 20; x += 30) {
      this.plane(p.util, 1.2, 0.18, wx(x), z(CORRIDOR), 0.62, 0.02)
    }
    slots.forEach((sl, i) => {
      const { r } = sl
      const util = r.cat === 'util'
      const bw = (sl.w - 3) * S, bd = (sl.h - 3) * S
      const cx = wx(sl.x + sl.w / 2), cz = z(sl.y + sl.h / 2)
      const baseH = util ? 0.7 : 1.25
      const it = this.block(`room:${r.id}`, {
        w: bw, h: baseH, d: bd, x: cx, z: cz, y: 0.62, color: p.room[r.cat], outline: true, delay: i * 45,
        pick: util ? undefined : { kind: 'room', id: r.id }, lift: 0, dimH: 0.45, selH: 1.85,
      })
      it.hl = p.hl
      if (util) {
        this.pin({ key: `u:${r.id}`, pos: new Vector3(cx, 0.62 + baseH + 0.1, cz), cls: 'cm-pin--util', html: /lift/.test(r.id) ? iconSvg('stairs', 14) : 'WC' })
        return
      }
      const idLabel = /^\w-\d{3}$/.test(r.id) ? r.id : r.name
      const el = this.pin({
        key: `room:${r.id}`, pos: new Vector3(cx, 0.62 + baseH + 0.2, cz), cls: `cm-pin--room${/^\w-\d{3}$/.test(r.id) ? '' : ' is-named'}`, delay: 220 + i * 45,
        html: `<span class="cm-pin__ic">${iconSvg(r.cat as CatId, 16)}</span><b>${idLabel}</b><em>${roomTitle(r)}${r.cap ? ` · ${plural(r.cap, FORMS.place)}` : ''}</em>`,
        label: `${roomTitle(r)}, ${CATS.find((c) => c.id === r.cat)?.name ?? ''}`, click: () => this.cb.room(r.id),
      })
      el.style.setProperty('--c', `var(--cm-${r.cat})`)
    })
    if (f === 1) {
      const h = slots.find((x) => /-hall$/.test(x.r.id))
      if (h) this.pin({ key: 'gate', pos: new Vector3(wx(h.x + h.w / 2), 0.4, z(BOT + PH + 38)), cls: 'cm-pin--poi', html: `${iconSvg('gate', 16)}<span>Главный вход</span>` })
    }
    this.routeBase = { slots, z }
  }
  private routeBase: { slots: ReturnType<typeof layoutPlan>; z: (py: number) => number } | null = null

  private makeRoute(id: string | null) {
    if (this.routeMesh) {
      this.world.remove(this.routeMesh)
      this.routeMesh.geometry.dispose()
      this.routeMesh = null
    }
    const st = this.state
    if (!id || !st || st.level !== 'plan' || !this.routeBase) return
    const r = ROOM[id]
    if (!r || r.b !== st.b || r.f !== st.f) return
    const pts = routePoints(this.routeBase.slots, st.f, id)
    if (!pts) return
    const z = this.routeBase.z
    const v = pts.map(([x, y]) => new Vector3(wx(x), 0.95, z(y)))
    const path = new CurvePath<Vector3>()
    for (let i = 1; i < v.length; i++) path.add(new LineCurve3(v[i - 1], v[i]))
    const geo = new TubeGeometry(path, Math.max(24, v.length * 22), 0.22, 8, false)
    const mat = this.mat(this.pal.ink)
    const m = new Mesh(geo, mat)
    m.castShadow = true
    this.routeMesh = m
    this.routeCount = geo.index ? geo.index.count : 0
    this.routeT0 = performance.now()
    geo.setDrawRange(0, reduced() ? this.routeCount : 0)
    const start = new Mesh(this.track(new CylinderGeometry(0.7, 0.7, 0.3, 20)), this.mat(this.pal.hl))
    start.position.copy(v[0]); start.position.y = 0.75
    const end = new Mesh(this.track(new CylinderGeometry(0.55, 0.55, 0.3, 20)), this.mat(this.pal.ink))
    end.position.copy(v[v.length - 1]); end.position.y = 1.0
    m.add(start, end)
    // m — дочерние объекты в мировых координатах: сам меш в начале координат
    this.world.add(m)
    this.dispose.push({ dispose: () => { geo.dispose() } })
  }

  /* ───────── применяем выбор, фильтр ───────── */
  private applyState(animate: boolean) {
    const s = this.state
    if (!s) return
    let selKey: string | null = null
    for (const it of this.items.values()) { it.selT = 0; it.dimT = 0 }
    if (s.level === 'territory') {
      selKey = s.sel ? `campus:${s.sel}` : null
      const it = s.sel ? this.items.get(s.sel) : null
      if (it) it.selT = 1
    } else if (s.level === 'campus') {
      selKey = s.sel ? `b:${s.sel}` : null
      const it = s.sel ? this.items.get(`b:${s.sel}`) : null
      if (it) it.selT = 1
      for (const m of this.markers) {
        const hit = s.match ? ROOMS.filter((r) => r.b === m.b && r.cat === m.cat && s.match!.has(r.id)).length : m.total
        m.hit = hit
        m.badge.textContent = String(hit)
        m.el.classList.toggle('is-dim', !!s.match && !hit)
        m.el.setAttribute('aria-label', `${CATS.find((c) => c.id === m.cat)!.name} в корпусе ${m.b}: ${plural(hit, FORMS.place)}. Открыть на плане этажа`)
      }
    } else {
      selKey = s.sel ? `room:${s.sel}` : null
      const it = s.sel ? this.items.get(`room:${s.sel}`) : null
      if (it) it.selT = 1
      for (const sl of layoutPlan(s.b, s.f)) {
        if (sl.r.cat === 'util') continue
        const dim = !!s.match && !s.match.has(sl.r.id)
        const item = this.items.get(`room:${sl.r.id}`)
        if (item) item.dimT = dim ? 1 : 0
        this.pinMap.get(`room:${sl.r.id}`)?.classList.toggle('is-dim', dim)
      }
      if (this.prevSel !== s.sel) this.makeRoute(s.sel)
    }
    for (const [k, el] of this.pinMap) {
      const on = k === selKey
      el.classList.toggle('is-sel', on)
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(on))
    }
    if (!animate || reduced()) for (const it of this.items.values()) { it.sel = it.selT; it.dim = it.dimT }
    // камера плавно подъезжает к выбранному
    const selId = s.sel
    if (animate && selId && selId !== this.prevSel && !this.tween) {
      const t = this.focusPoint(s)
      if (t) {
        const cur = this.controls.target
        this.flyTo({ target: new Vector3(cur.x + (t.x - cur.x) * 0.7, 0, cur.z + (t.z - cur.z) * 0.7) }, 460)
      }
    }
    window.setTimeout(() => this.refreshInset(), 380)
    this.prevSel = selId
    this.request()
  }
  private focusPoint(s: SceneState): Vector3 | null {
    if (s.level === 'territory' && s.sel) {
      const c = CAMPUSES[s.sel].plot
      return new Vector3(wx(c.x + c.w / 2), 0, (c.y + c.h / 2 - 320) * S)
    }
    if (s.level === 'campus' && s.sel) {
      const bx = BUILDINGS[s.sel].box
      return new Vector3(wx(bx.x + bx.w / 2), 0, (bx.y + bx.h / 2 - 320) * S)
    }
    if (s.level === 'plan' && s.sel) {
      const sl = layoutPlan(s.b, s.f).find((x) => x.r.id === s.sel)
      if (sl) return new Vector3(wx(sl.x + sl.w / 2), 0, (sl.y + sl.h / 2 - 265) * S)
    }
    return null
  }

  /* ───────── выбор мышью и пальцем ───────── */
  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    this.host.classList.add('is-drag')
  }
  private onUp = (e: PointerEvent) => {
    this.host.classList.remove('is-drag')
    const d = this.down
    this.down = null
    if (!d || d.id !== e.pointerId) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return
    const hit = this.pick(e.clientX, e.clientY)
    if (!hit) return this.cb.bg()
    if (hit.kind === 'campus') this.cb.campus(hit.id as CampusId)
    else if (hit.kind === 'building') this.cb.building(hit.id as BuildingId)
    else this.cb.room(hit.id)
  }
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons) return
    if (this.hoverRaf) return
    const x = e.clientX, y = e.clientY
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0
      const h = this.pick(x, y)
      this.setHover(h ? (h.kind === 'campus' ? h.id : h.kind === 'building' ? `b:${h.id}` : `room:${h.id}`) : null)
    })
  }
  private pick(cx: number, cy: number): Pickable | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera)
    const hits = this.ray.intersectObjects(this.picks, false)
    return hits.length ? (hits[0].object.userData as Pickable) : null
  }
  private setHover(id: string | null) {
    if (id === this.hoverId) return
    this.hoverId = id
    for (const it of this.items.values()) it.hoverT = it.id === id || (id && it.id.startsWith(`${id}:`)) ? 1 : 0
    this.host.style.cursor = id ? 'pointer' : ''
    this.request()
  }

  /* ───────── кадр ───────── */
  request() {
    this.dirty = true
    if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this.frame)
  }
  private frame = (now: number) => {
    this.raf = 0
    if (this.dead) return
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016)
    this.last = now
    let busy = false
    // перелёт камеры
    if (this.tween) {
      const tw = this.tween
      const p = Math.min(1, (now - tw.t0) / tw.ms)
      const e = easeInOut(p)
      this.setView({
        target: tw.from.target.clone().lerp(tw.to.target, e),
        az: tw.from.az + (tw.to.az - tw.from.az) * e,
        pol: tw.from.pol + (tw.to.pol - tw.from.pol) * e,
        zoom: tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e,
      })
      if (p >= 1) { this.tween = null; this.controls.enabled = true; tw.done?.() }
      busy = true
    } else if (this.controls.update()) busy = true
    // сдвиг кадра над шторкой
    if (Math.abs(this.shift - this.shiftT) > 0.5) {
      this.shift += (this.shiftT - this.shift) * (reduced() ? 1 : 1 - Math.exp(-dt * 10))
      this.applyProjection()
      busy = true
    }
    // подсветка, подъём, рост
    const k = reduced() ? 1 : 1 - Math.exp(-dt * 14)
    for (const it of this.items.values()) {
      const gT = (now - it.t0) / 460
      const gr = reduced() ? 1 : easeOut(gT)
      if (gr < 1) busy = true
      if (Math.abs(it.sel - it.selT) > 0.004 || Math.abs(it.dim - it.dimT) > 0.004 || Math.abs(it.hover - it.hoverT) > 0.004) {
        it.sel += (it.selT - it.sel) * k
        it.dim += (it.dimT - it.dim) * k
        it.hover += (it.hoverT - it.hover) * k
        busy = true
      } else { it.sel = it.selT; it.dim = it.dimT; it.hover = it.hoverT }
      const hs = (1 - it.dim * (1 - it.dimH)) * (1 + it.sel * (it.selH - 1))
      it.group.scale.y = Math.max(0.001, gr * hs)
      it.group.position.y = it.sel * it.lift * Math.max(0.2, gr)
      const ring = it.group.userData.ring as Object3D | undefined
      if (ring) ring.visible = it.sel > 0.05
      it.mats.forEach((m, i) => {
        m.color.copy(it.base[i])
        if (it.dim) m.color.lerp(this.pal.ground, it.dim * 0.55)
        if (it.sel) m.color.lerp(it.hl, it.sel * (it.mats.length > 1 && i < it.mats.length - 1 ? 0.12 : 0.9))
        if (it.hover) m.color.lerp(this.pal.surface, it.hover * 0.22)
      })
    }
    // маршрут «рисуется»
    if (this.routeMesh && this.routeCount) {
      const p = reduced() ? 1 : easeInOut((now - this.routeT0 - 250) / 900)
      this.routeMesh.geometry.setDrawRange(0, Math.floor((this.routeCount * Math.max(0, p)) / 3) * 3)
      if (p < 1) busy = true
    }
    if ((busy || this.dirty) && !this.lost) {
      this.renderer.render(this.scene, this.camera)
      this.placePins()
    }
    this.dirty = false
    if (busy) this.raf = requestAnimationFrame(this.frame)
  }

  private placePins() {
    const v = new Vector3()
    const w = this.w, h = this.h
    for (const p of this.pins) {
      v.copy(p.pos).project(this.camera)
      const x = (v.x * 0.5 + 0.5) * w
      const y = (-v.y * 0.5 + 0.5) * h
      p.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`
      p.el.style.zIndex = String(Math.round((1 - v.z) * 500) + (p.el.classList.contains('is-sel') ? 1000 : 0))
    }
  }

  /** Подпись текущего вида для скринридера. */
  describe(): string {
    const s = this.state
    if (!s) return ''
    if (s.level === 'territory') return 'Объёмная карта территории. Вращайте её пальцем или мышью, кампусы доступны кнопками на карте и в списке.'
    if (s.level === 'campus') return `Объёмная схема: ${CAMPUSES[s.campus].name}.`
    return `Объёмный план: корпус ${s.b}, ${s.f} этаж.`
  }
}

export type { CamView }
