import { Award, Medal, Trophy } from 'lucide-react'
import { money } from '../lib/format'

const PODIUM = {
  1: { Icon: Trophy, icon: 'text-yellow-500', row: 'bg-yellow-50', name: 'text-yellow-700', worth: 'text-yellow-600' },
  2: { Icon: Medal, icon: 'text-gray-400', row: 'bg-gray-50', name: 'text-gray-900', worth: 'text-gray-900' },
  3: { Icon: Award, icon: 'text-amber-600', row: 'bg-orange-50', name: 'text-gray-900', worth: 'text-gray-900' },
}

/**
 * Ranking de jugadores. `rows`: [{ user_id, username, cash, positions_value, net_worth, rank }]
 * `onSelect(row)` hace las filas clicables (vista Recuerdos).
 */
export default function Leaderboard({ rows, meId, onSelect, selectedId }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <ol className="divide-y divide-gray-100">
        {rows.map((row) => {
          const podium = PODIUM[row.rank]
          const isMe = meId && row.user_id === meId
          const clickable = typeof onSelect === 'function'
          const Wrapper = clickable ? 'button' : 'div'
          return (
            <li key={row.user_id}>
              <Wrapper
                onClick={clickable ? () => onSelect(row) : undefined}
                className={`w-full text-left flex items-center gap-3 px-4 py-3.5 ${podium?.row || ''} ${
                  isMe ? 'ring-2 ring-inset ring-polyblue/40' : ''
                } ${selectedId === row.user_id ? 'bg-blue-50' : ''} ${clickable ? 'hover:bg-gray-50' : ''}`}
              >
                <div className="w-9 flex items-center justify-center flex-shrink-0">
                  {podium ? (
                    <podium.Icon size={row.rank === 1 ? 26 : 22} className={podium.icon} strokeWidth={2.5} />
                  ) : (
                    <span className="font-bold text-gray-500">{row.rank}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold truncate ${podium?.name || 'text-gray-900'}`}>{row.username}</span>
                    {isMe && (
                      <span className="text-[10px] font-bold uppercase bg-polyblue text-white rounded px-1.5 py-0.5">Tú</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    Efectivo {money(row.cash)} · En acciones {money(row.positions_value)}
                  </div>
                </div>
                <div className={`text-right font-bold text-lg ${podium?.worth || 'text-gray-900'}`}>
                  {money(row.net_worth)}
                </div>
              </Wrapper>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
