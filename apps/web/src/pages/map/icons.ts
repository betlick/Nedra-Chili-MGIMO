// Иконки карты: 24×24, линия 1.8. Рисуются и как отдельный <svg>, и внутри схемы (через transform).
export const MAP_ICONS = {
  lecture: 'M3 5h18v10H3z M8 21h8 M12 15v6',
  seminar: 'M9 11a3 3 0 100-6 3 3 0 000 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 5.2a3 3 0 010 5.6 M18 14.3c1.8.8 3 2.5 3 4.7',
  practice: 'M4 6h16v10H4z M2 19h20',
  food: 'M7 3v8 M4 3v5a3 3 0 006 0V3 M7 11v10 M17 21V3c-2.5 1-4 4-4 8h4',
  cowork: 'M5 9h11v6a5 5 0 01-5 5H10a5 5 0 01-5-5V9z M16 11h2a2.5 2.5 0 010 5h-2 M8 3v3 M12 3v3',
  sport: 'M6 7v10 M3 9v6 M18 7v10 M21 9v6 M6 12h12',
  service: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 11v6 M12 7.5v.01',
  util: 'M5 12h14 M12 5v14',
  building: 'M4 21V5l8-3 8 3v16 M9 21v-5h6v5 M8 8h.01 M12 8h.01 M16 8h.01 M8 12h.01 M12 12h.01 M16 12h.01',
  gate: 'M4 21V8l8-5 8 5v13 M9 21v-7h6v7',
  bike: 'M6 18a3 3 0 100-6 3 3 0 000 6z M18 18a3 3 0 100-6 3 3 0 000 6z M6 15l4-8h5l3 8 M10 7h-2',
  bus: 'M5 17V6a3 3 0 013-3h8a3 3 0 013 3v11z M5 11h14 M8 17v3 M16 17v3 M8 14h.01 M16 14h.01',
  stairs: 'M3 20h5v-5h5v-5h5V5h3',
  x: 'M6 6l12 12 M18 6L6 18',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  rotl: 'M4 12a8 8 0 108-8 M4 4v5h5',
  rotr: 'M20 12a8 8 0 11-8-8 M20 4v5h-5',
  home: 'M3 11l9-8 9 8 M5 10v10h14V10 M10 20v-6h4v6',
} as const
export type MapIconName = keyof typeof MAP_ICONS
