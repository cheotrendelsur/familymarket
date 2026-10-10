import { useState } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useGame } from '../../context/GameContext'
import { fireSoftConfetti, haptic, HAPTIC } from '../../lib/fx'
import MarketForm from './MarketForm'
import { Card } from './adminUi'

export default function CreateTab() {
  const { config, refreshMarkets } = useGame()
  const [formKey, setFormKey] = useState(0)

  const create = async (v) => {
    const img = v.image || {}
    const common = {
      p_description: v.description,
      p_category: v.category,
      p_closes_at: v.closes_at,
      p_opens_at: v.opens_at,
      p_image_url: img.image_url || null,
      p_image_thumb_url: img.image_thumb_url || null,
      p_image_color: img.image_color || null,
      p_target_users: v.target_users,
    }
    if (v.kind === 'multiple') {
      const data = await rpc('staff_create_market_group', { p_topic: v.question, p_options: v.options, ...common })
      toast.success(`¡Listo! ${data.created} opciones publicadas en «${v.question}»`, { duration: 5000 })
    } else {
      await rpc('staff_create_market', { p_question: v.question, ...common })
      toast.success('¡Mercado publicado! Ya aparece en Inicio.', { duration: 4500 })
    }
    haptic(HAPTIC.success)
    fireSoftConfetti()
    setFormKey((k) => k + 1) // limpia el formulario
    window.scrollTo({ top: 0, behavior: 'smooth' })
    refreshMarkets()
  }

  return (
    <Card
      title="Crear mercado"
      subtitle={`Empieza con ${config.initial_liquidity} de liquidez por lado · 50% / 50%`}
      icon={<Plus size={24} strokeWidth={2.6} />}
    >
      <MarketForm key={formKey} submitLabel="Publicar mercado" onSubmit={create} />
    </Card>
  )
}
