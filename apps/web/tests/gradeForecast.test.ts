import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forecastGrade, validateForecast, type ForecastInput } from '../src/lib/gradeForecast'
import { gradeLabel, markFor } from '../src/lib/format'

const plan: ForecastInput = {
  lectures: 8, lecturesAttended: 2, lecturesUpcoming: 4,
  practices: 8, practicesAttended: 3, practicesUpcoming: 3,
  control: 16,
}

test('прогноз считает общий вес лекций и практик и даёт достижимый план', () => {
  const result = forecastGrade(plan, 80)
  assert.equal(result.reachable, true)
  if (!result.reachable) return
  const attendance = (plan.lecturesAttended + plan.lecturesUpcoming) * 10 / plan.lectures
    + (plan.practicesAttended + plan.practicesUpcoming) * 10 / plan.practices
  assert.ok(attendance + plan.control + result.controlNeeded + result.finalNeeded >= 80)
  assert.ok(result.controlNeeded <= 40 - plan.control)
  assert.ok(result.finalNeeded <= 40)
  assert.equal(result.lecturesToAttend, plan.lecturesUpcoming)
  assert.equal(result.practicesToAttend, plan.practicesUpcoming)
  assert.equal(result.controlNeeded, Math.max(0, Math.ceil(80 - attendance - plan.control) - 40))
})

test('пропущенные занятия делают порог недостижимым', () => {
  const result = forecastGrade({ lectures: 8, lecturesAttended: 0, lecturesUpcoming: 0, practices: 8, practicesAttended: 0, practicesUpcoming: 0, control: 0 }, 85)
  assert.equal(result.reachable, false)
})

test('нельзя указать посещений больше всего занятий или контроль выше 40', () => {
  assert.match(validateForecast({ ...plan, lecturesAttended: 5 }) ?? '', /Посещённых/)
  assert.match(validateForecast({ ...plan, control: 41 }) ?? '', /40/)
})

test('границы оценок и зачёта — 40, 60 и 80', () => {
  assert.deepEqual([39, 40, 59, 60, 79, 80].map(markFor), [2, 3, 3, 4, 4, 5])
  assert.equal(gradeLabel(39, 'Зачёт'), 'Не зачтено')
  assert.equal(gradeLabel(40, 'Зачёт'), 'Зачтено')
})
