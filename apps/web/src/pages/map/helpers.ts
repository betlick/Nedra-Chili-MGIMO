export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 759px)').matches
