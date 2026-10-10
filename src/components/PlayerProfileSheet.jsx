import { useEffect, useState } from 'react'
import { Flame, Target, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import { rpc } from '../lib/api'
import { categoryOf } from '../lib/categories'
import { friendlyError, money, pct, signedMoney } from '../lib/format'
import { Avatar } from './Leaderboard'
import PortfolioChart from './PortfolioChart'
import Sheet from './ui/Sheet'

function Stat({ icon: Icon, label, value, tone = 'text-gray-900' }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 mb-1">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`text-xl font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

/** Perfil de un jugador con sus estadísticas (solo mercados que tú también puedes ver). */
export default function PlayerProfileSheet({ player, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!player) return undefined
    let cancelled = false
    setData(null)
    setError(null)
    rpc('get_player_profile', { p_user_id: player.user_id })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(friendlyError(e)))
    return () => {
      cancelled = true
    }
  }, [player])

  const decided = data ? data.wins + data.losses : 0
  const streakText =
    data && data.current_streak > 0 ? `${data.current_streak} ${data.current_streak_kind === 'W' ? 'ganadas' : 'perdidas'}` : '—'

  return (
    <Sheet open={!!player} onClose={onClose}>
      {player && (
        <div className="pb-2">
          <div className="flex items-center gap-4 mb-5">
            <Avatar name={player.username} size={64} ring />
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold text-gray-900 truncate">{player.username}</h2>
              <p className="text-sm text-gray-500">
                Puesto <b>#{player.rank}</b> · {money(player.net_worth)}
              </p>
            </div>
          </div>

          <div className="mb-3">
            <PortfolioChart
              key={player.user_id}
              userId={player.user_id}
              title="Su portafolio"
              liveNet={Number.isFinite(Number(player.net_worth)) ? Number(player.net_worth) : undefined}
              liveCash={player.cash != null && Number.isFinite(Number(player.cash)) ? Number(player.cash) : undefined}
            />
          </div>

          {error && <p className="bg-red-50 text-red-700 text-sm rounded-xl p-3">{error}</p>}
          {!data && !error && (
            <div className="grid grid-cols-2 gap-3" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-[74px] rounded-2xl" />
              ))}
            </div>
          )}

          {data && (
            <div className="space-y-3 animate-fade-in">
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                    <Target size={13} /> Aciertos
                  </span>
                  <span className="font-extrabold text-gray-900">
                    {decided > 0 ? pct(data.win_rate, 0) : '—'}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-rose-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-polygreen transition-all duration-700"
                    style={{ width: decided > 0 ? `${Math.round(data.win_rate * 100)}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {decided > 0
                    ? `${data.wins} ganadas · ${data.losses} perdidas en mercados ya resueltos`
                    : 'Todavía no hay mercados resueltos con sus apuestas'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat icon={Trophy} label="Ganancia realizada" value={signedMoney(data.realized_pl)} tone={data.realized_pl >= 0 ? 'text-polygreen' : 'text-polyred'} />
                <Stat icon={Flame} label="Racha actual" value={streakText} />
                <Stat label="Operaciones" value={data.trades} />
                <Stat label="Mercados jugados" value={data.markets_traded} />
                <Stat label="Mejor racha" value={data.best_win_streak > 0 ? `${data.best_win_streak} seguidas` : '—'} />
                <Stat label="Categoría favorita" value={data.favorite_category ? `${categoryOf(data.favorite_category).emoji} ${categoryOf(data.favorite_category).label}` : '—'} />
              </div>

              {data.best_win?.amount > 0 && (
                <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5">
                  <TrendingUp size={18} className="text-polygreen mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-700">Su mejor jugada · {signedMoney(data.best_win.amount)}</p>
                    <p className="text-sm text-gray-800 leading-snug">{data.best_win.question}</p>
                  </div>
                </div>
              )}
              {data.worst_loss?.amount < 0 && (
                <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 rounded-2xl p-3.5">
                  <TrendingDown size={18} className="text-polyred mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-rose-700">Su peor jugada · {signedMoney(data.worst_loss.amount)}</p>
                    <p className="text-sm text-gray-800 leading-snug">{data.worst_loss.question}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
