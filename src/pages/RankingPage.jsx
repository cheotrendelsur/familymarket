import { useCallback, useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import { rpc } from '../lib/api'
import { money } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { usePolling } from '../hooks/usePolling'
import Leaderboard, { Podium } from '../components/Leaderboard'
import NetWorthChart from '../components/NetWorthChart'
import PlayerProfileSheet from '../components/PlayerProfileSheet'
import { Skeleton } from '../components/ui/Skeleton'

export default function RankingPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState(null)
  const [selected, setSelected] = useState(null)

  const fetchRanking = useCallback(async () => {
    setRows((await rpc('get_leaderboard')) || [])
  }, [])
  usePolling(fetchRanking, { interval: 30000 })

  const me = rows?.find((r) => r.user_id === profile?.id)
  const above = me && me.rank > 1 ? rows.find((r) => r.rank === me.rank - 1) : null
  const gap = me && above ? Number(above.net_worth) - Number(me.net_worth) : null

  const sorted = useMemo(() => rows || [], [rows])

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-5">
      <div className="flex items-center gap-3">
        <Trophy size={26} className="text-amber-500" />
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Ranking familiar</h1>
          <p className="text-sm text-gray-500">Toca a un jugador para ver sus estadísticas</p>
        </div>
      </div>

      {!rows && (
        <div className="space-y-3">
          <Skeleton className="h-[190px] rounded-3xl" />
          <Skeleton className="h-[260px] rounded-2xl" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="text-center py-14 bg-white rounded-3xl border border-gray-200 text-gray-500">
          El ranking aparecerá cuando los jugadores elijan su nombre.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {me && (
            <div className="rounded-2xl bg-gradient-to-br from-polyblue to-blue-600 text-white p-4 shadow-lg shadow-blue-500/20 animate-slide-up">
              <p className="text-xs font-semibold text-blue-100">Tu posición</p>
              <div className="flex items-end justify-between mt-0.5">
                <p className="text-3xl font-black">#{me.rank}</p>
                <p className="text-xl font-extrabold tabular-nums">{money(me.net_worth)}</p>
              </div>
              <p className="text-xs text-blue-100 mt-1.5">
                {me.rank === 1
                  ? '¡Vas liderando! Cuida tu corona 👑'
                  : gap !== null
                  ? `Te faltan ${money(gap)} para alcanzar a ${above.username}`
                  : ''}
              </p>
            </div>
          )}

          {rows.length >= 3 && (
            <div className="bg-white rounded-3xl border border-gray-200 shadow-card px-3 pt-2 pb-0 overflow-hidden">
              <Podium rows={sorted} meId={profile?.id} onSelect={setSelected} />
            </div>
          )}

          <Leaderboard rows={sorted} meId={profile?.id} onSelect={setSelected} />

          <NetWorthChart leaderboard={sorted} meId={profile?.id} />
        </>
      )}

      <PlayerProfileSheet player={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
