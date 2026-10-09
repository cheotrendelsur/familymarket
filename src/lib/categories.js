// Categorías de mercados (deben coincidir con el check de public.markets.category).
export const CATEGORIES = [
  { id: 'deportes', label: 'Deportes', emoji: '⚽', from: '#34d399', to: '#059669' },
  { id: 'familia', label: 'Familia', emoji: '👨‍👩‍👧', from: '#f9a8d4', to: '#db2777' },
  { id: 'comida', label: 'Comida', emoji: '🍕', from: '#fdba74', to: '#ea580c' },
  { id: 'viaje', label: 'Viaje', emoji: '🏝️', from: '#67e8f9', to: '#0284c7' },
  { id: 'juegos', label: 'Juegos', emoji: '🎲', from: '#c4b5fd', to: '#7c3aed' },
  { id: 'clima', label: 'Clima', emoji: '⛅', from: '#93c5fd', to: '#2563eb' },
  { id: 'musica', label: 'Música', emoji: '🎵', from: '#fda4af', to: '#e11d48' },
  { id: 'otros', label: 'Otros', emoji: '✨', from: '#fde68a', to: '#d97706' },
]

const BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))

export const categoryOf = (id) => BY_ID[id] || BY_ID.otros
