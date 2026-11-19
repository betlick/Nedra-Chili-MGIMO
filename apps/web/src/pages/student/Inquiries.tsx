import { Navigate } from 'react-router-dom'

/** Обращения к преподавателям теперь внутри «Заявок»: старые ссылки и уведомления ведут туда. */
export function StudentInquiriesPage() {
  return <Navigate to="/student/requests?to=teacher" replace />
}
