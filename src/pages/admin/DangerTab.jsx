import { useState } from 'react'
import toast from 'react-hot-toast'
import { Archive } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useGame } from '../../context/GameContext'
import { useConfirm } from '../../components/ConfirmDialog'
import { friendlyError, money } from '../../lib/format'
import { Field, inputClass } from './adminUi'

export default function DangerTab() {
  const { config, refreshMarkets, refreshSession } = useGame()
  const confirm = useConfirm()
  const [title, setTitle] = useState('')
  const [word, setWord] = useState('')
  const [loading, setLoading] = useState(false)

  const run = async () => {
    const finalTitle = title.trim() || `FamilyMarket · ${new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })}`
    const ok = await confirm({
      title: 'Archivar y reiniciar la partida',
      message: `Se guardará una copia completa en «Recuerdos» (${finalTitle}) y luego TODO vuelve a cero: mercados, acciones y operaciones se borran y cada jugador vuelve a ${money(config.initial_balance)}.\n\nLas cuentas, nombres y moderadores se conservan.`,
      confirmText: 'Archivar y reiniciar',
      tone: 'danger',
    })
    if (!ok) return
    setLoading(true)
    try {
      const slug = `juego-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`
      const data = await rpc('admin_archive_and_reset', { p_title: finalTitle, p_slug: slug })
      toast.success(`Partida archivada (${data.players} jugadores, ${data.markets} mercados). ¡Listos para empezar de cero!`, { duration: 7000 })
      setWord('')
      setTitle('')
      refreshMarkets()
      refreshSession()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 7000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Guarda esta partida completa en «Recuerdos» y deja a todos en {money(config.initial_balance)} sin mercados. Las cuentas y los moderadores se conservan.</p>
        <Field label="Título del recuerdo (opcional)">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="FamilyMarket · Viaje a Margarita" className={inputClass} maxLength={80} />
        </Field>
        <Field label="Escribe REINICIAR para confirmar">
          <input type="text" value={word} onChange={(e) => setWord(e.target.value)} className={inputClass} autoComplete="off" />
        </Field>
        <button
          onClick={run}
          disabled={loading || word.trim().toUpperCase() !== 'REINICIAR'}
          className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-40 shadow-lg shadow-red-500/20"
        >
          <Archive size={20} /> {loading ? 'Archivando…' : 'Archivar y reiniciar partida'}
        </button>
      </div>
    </div>
  )
}
