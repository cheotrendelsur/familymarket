import { Crown } from 'lucide-react'
import { avatarColor, initials, money } from '../lib/format'

export function Avatar({ name, size = 40, ring = false }) {
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ${ring ? 'ring-4 ring-white shadow-lg' : ''}`}
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  )
}

const PODIUM = {
  1: { h: 96, bar: 'from-yellow-300 to-amber-500', label: '1º' },
  2: { h: 70, bar: 'from-slate-200 to-slate-400', label: '2º' },
  3: { h: 52, bar: 'from-orange-300 to-amber-700', label: '3º' },
}

/** Podio animado con los tres primeros. */
export function Podium({ rows, meId, onSelect }) {
  const top = [rows.find((r) => r.rank === 2), rows.find((r) => r.rank === 1), rows.find((r) => r.rank === 3)]
  return (
    <div className="grid grid-cols-3 gap-2 items-end pt-6" aria-label="Podio">
      {top.map((row, i) => {
        if (!row) return <div key={i} />
        const p = PODIUM[row.rank]
        const isMe = row.user_id === meId
        return (
          <button
            key={row.user_id}
            onClick={() => onSelect?.(row)}
            className="flex flex-col items-center text-center min-w-0 tap-feedback"
          >
            <div className="relative mb-2 animate-pop" style={{ animationDelay: `${0.1 + i * 0.12}s` }}>
              {row.rank === 1 && (
                <Crown size={26} className="absolute -top-6 left-1/2 -translate-x-1/2 text-amber-500 animate-bounce-soft" fill="#FBBF24" />
              )}
              <Avatar name={row.username} size={row.rank === 1 ? 62 : 52} ring />
            </div>
            <p className={`text-sm font-bold truncate max-w-full ${isMe ? 'text-polyblue' : 'text-gray-900'}`}>{row.username}</p>
            <p className="text-xs font-semibold text-gray-500 tabular-nums mb-1.5">{money(row.net_worth, 0)}</p>
            <div
              className={`w-full rounded-t-2xl bg-gradient-to-b ${p.bar} flex items-start justify-center pt-2 text-white font-extrabold text-lg origin-bottom shadow-inner`}
              style={{ height: p.h, animation: `pop 0.55s cubic-bezier(0.34,1.56,0.64,1) ${0.25 + i * 0.12}s both` }}
            >
              {p.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Ranking de jugadores. `rows`: [{ user_id, username, cash, positions_value, net_worth, rank }]
 * `onSelect(row)` hace las filas clicables.
 */
export default function Leaderboard({ rows, meId, onSelect, selectedId }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
      <ol className="divide-y divide-gray-100">
        {rows.map((row) => {
          const isMe = meId && row.user_id === meId
          const clickable = typeof onSelect === 'function'
          const Wrapper = clickable ? 'button' : 'div'
          return (
            <li key={row.user_id}>
              <Wrapper
                onClick={clickable ? () => onSelect(row) : undefined}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 ${
                  isMe ? 'bg-blue-50/60' : ''
                } ${selectedId === row.user_id ? 'bg-blue-50' : ''} ${clickable ? 'hover:bg-gray-50 active:bg-gray-100' : ''}`}
              >
                <span className="w-6 text-center font-extrabold text-gray-400 flex-shrink-0">{row.rank}</span>
                <Avatar name={row.username} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate text-gray-900">{row.username}</span>
                    {isMe && <span className="text-[10px] font-bold uppercase bg-polyblue text-white rounded px-1.5 py-0.5">Tú</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">Efectivo {money(row.cash, 0)}</div>
                </div>
                <div className="text-right tabular-nums flex-shrink-0">
                  <div className="font-extrabold text-gray-900">{money(row.net_worth)}</div>
                  <div className="text-[11px] text-gray-400">{money(row.positions_value, 0)} apostado</div>
                </div>
              </Wrapper>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
