import { useState } from 'react'
import toast from 'react-hot-toast'
import { Gift } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useGame } from '../../context/GameContext'
import { friendlyError, money } from '../../lib/format'
import { Field, inputClass } from './adminUi'

/** Premio por mercado sorpresa: lo que reciben, al resolverse, quienes no pudieron participar. */
export default function RewardCard() {
  const { config, refreshConfig } = useGame()
  const [pct, setPct] = useState(String(Math.round((config.hidden_reward_pct ?? 0.02) * 1000) / 10))
  const [cap, setCap] = useState(String(config.hidden_reward_cap ?? 40))
  const [mode, setMode] = useState(config.hidden_reward_mode || 'shared')
  const [busy, setBusy] = useState(false)

  const pctValue = parseFloat(String(pct).replace(',', '.'))
  const capValue = parseFloat(String(cap).replace(',', '.'))
  const valid = pctValue >= 0 && pctValue <= 20 && capValue >= 0 && capValue <= 1000
  const changed =
    valid &&
    (Math.abs(pctValue / 100 - (config.hidden_reward_pct ?? 0.02)) > 1e-9 || capValue !== (config.hidden_reward_cap ?? 40) || mode !== (config.hidden_reward_mode || 'shared'))

  const each = (volume, people) => {
    const raw = mode === 'each' ? volume * (pctValue / 100) : (volume * (pctValue / 100)) / people
    return Math.min(raw, capValue)
  }

  const save = async () => {
    setBusy(true)
    try {
      await rpc('admin_set_reward', { p_pct: pctValue / 100, p_cap: capValue, p_mode: mode })
      await refreshConfig()
      toast.success('Premio guardado', { duration: 3500 })
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 flex gap-2">
        <Gift size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        Cuando ocultas un mercado a alguien (mercado sorpresa), esa persona recibe automáticamente un premio al resolverse el mercado, como compensación por no poder participar.
        Se calcula sobre el <b>dinero total apostado</b> en ese mercado.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Porcentaje del dinero apostado">
          <div className="relative">
            <input id="reward-pct" aria-label="Porcentaje del premio" type="number" inputMode="decimal" min={0} max={20} step={0.5} value={pct} onChange={(e) => setPct(e.target.value)} className={`${inputClass} pr-9`} />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
          </div>
        </Field>
        <Field label="Máximo por persona">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
            <input id="reward-cap" aria-label="Máximo por persona" type="number" inputMode="decimal" min={0} max={1000} step={5} value={cap} onChange={(e) => setCap(e.target.value)} className={`${inputClass} pl-8`} />
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cómo se reparte">
        {[
          ['shared', 'Se reparte', 'El porcentaje es una bolsa que se divide entre las personas ocultas'],
          ['each', 'Cada una', 'Cada persona oculta recibe ese porcentaje completo'],
        ].map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`text-left rounded-xl border-2 p-3 transition-colors ${mode === id ? 'border-polyblue bg-blue-50' : 'border-gray-200 bg-white'}`}
          >
            <span className={`block font-bold text-sm ${mode === id ? 'text-polyblue' : 'text-gray-800'}`}>{label}</span>
            <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">{hint}</span>
          </button>
        ))}
      </div>
      {valid && (
        <div className="bg-gray-50 rounded-2xl p-3.5 text-sm text-gray-700 space-y-1" aria-label="Ejemplos">
          <p className="font-bold text-gray-800">Ejemplos</p>
          {[
            [1000, 1],
            [3000, 1],
            [3000, 3],
          ].map(([volume, people]) => (
            <p key={`${volume}-${people}`}>
              Se apuestan <b>{money(volume)}</b> y se le ocultó a {people} {people === 1 ? 'persona' : 'personas'}: {people === 1 ? 'recibe' : 'reciben'}{' '}
              <b>{money(each(volume, people))}</b>{people > 1 ? ' cada una' : ''}.
            </p>
          ))}
        </div>
      )}
      <button onClick={save} disabled={busy || !changed} className="w-full bg-gray-900 text-white py-3.5 rounded-xl font-bold disabled:opacity-40">
        {busy ? 'Guardando…' : 'Guardar premio'}
      </button>
    </div>
  )
}
