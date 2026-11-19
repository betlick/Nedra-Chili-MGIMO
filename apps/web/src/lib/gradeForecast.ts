export interface ForecastInput {
  lectures: number
  lecturesAttended: number
  lecturesUpcoming: number
  practices: number
  practicesAttended: number
  practicesUpcoming: number
  control: number
}

export const FORECAST_WEIGHTS = { lectures: 10, practices: 10, control: 40, final: 40 } as const
export const GRADE_TARGETS = [
  { label: '3', points: 40 },
  { label: '4', points: 60 },
  { label: '5', points: 80 },
] as const

export function validateForecast(v: ForecastInput): string | null {
  if (Object.values(v).some(n => !Number.isInteger(n) || n < 0)) return 'Введите целые неотрицательные числа.'
  if (v.lectures > 200 || v.practices > 200) return 'Количество занятий должно быть не больше 200.'
  if (v.control > 40) return 'За текущий контроль можно набрать не более 40 баллов.'
  if (v.lecturesAttended + v.lecturesUpcoming > v.lectures || v.practicesAttended + v.practicesUpcoming > v.practices)
    return 'Посещённых и оставшихся занятий не может быть больше общего числа.'
  return null
}

export function forecastGrade(v: ForecastInput, target: number) {
  const attended = (v.lectures ? v.lecturesAttended * 10 / v.lectures : 0)
    + (v.practices ? v.practicesAttended * 10 / v.practices : 0)
  const future = (v.lectures ? v.lecturesUpcoming * 10 / v.lectures : 0)
    + (v.practices ? v.practicesUpcoming * 10 / v.practices : 0)
  const maximum = attended + future + 80
  if (maximum + 1e-9 < target) return { reachable: false as const, maximum }
  const missing = Math.max(0, Math.ceil(target - attended - future - v.control - 1e-9))
  const remainingControl = 40 - v.control
  // Maximize attendance, then minimize new control points by allowing up to 40 at the final.
  const controlNeeded = Math.min(remainingControl, Math.max(0, missing - 40))
  return { reachable: true as const, attended, future, lecturesToAttend: v.lecturesUpcoming, practicesToAttend: v.practicesUpcoming, controlNeeded, finalNeeded: missing - controlNeeded }
}
