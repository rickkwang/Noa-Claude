// @ts-nocheck
import * as React from 'react'
import { feature } from 'bun:bundle'
import type { Command } from '../../types/command.js'
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js'
import { getCompanion, roll, companionUserId } from '../../buddy/companion.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { RARITY_STARS } from '../../buddy/types.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  const companion = getCompanion()
  const arg = args?.trim().toLowerCase()

  if (arg === 'pet') {
    if (companion) {
      onDone(`You pet ${companion.name}! ${companion.name} seems happy.`)
    } else {
      onDone('You pet the air. No companion yet!')
    }
    return null
  }

  if (arg === 'mute' || arg === 'off') {
    saveGlobalConfig(prev => ({ ...prev, companionMuted: true }))
    onDone('Companion muted')
    return null
  }

  if (arg === 'unmute' || arg === 'on') {
    saveGlobalConfig(prev => ({ ...prev, companionMuted: false }))
    onDone('Companion unmuted')
    return null
  }

  if (!companion) {
    const userId = companionUserId()
    roll(userId)
    const name = generateName()
    
    saveGlobalConfig(prev => ({
      ...prev,
      companion: {
        name,
        personality: generatePersonality(),
        hatchedAt: Date.now(),
      },
    }))
    
    const newCompanion = getCompanion()
    if (newCompanion) {
      const stars = RARITY_STARS[newCompanion.rarity] || ''
      const shiny = newCompanion.shiny ? ' ✨ SHINY!' : ''
      onDone(`🎉 ${newCompanion.name} the ${newCompanion.species}${stars}${shiny} has joined you!`)
    }
    return null
  }

  const stars = RARITY_STARS[companion.rarity] || ''
  const shiny = companion.shiny ? ' ✨' : ''
  onDone(`${companion.name} ${stars}${shiny} - Use /buddy pet to pet, /buddy mute to hide`)
  return null
}

function generateName(): string {
  const adjectives = ['Fluffy', 'Tiny', 'Cosmic', 'Mystic', 'Shadow', 'Golden', 'Silver', 'Ancient', 'Wild']
  const nouns = ['Duck', 'Goose', 'Blob', 'Cat', 'Dragon', 'Octopus', 'Owl', 'Penguin', 'Turtle', 'Snail', 'Ghost', 'Capybara', 'Cactus', 'Robot', 'Rabbit']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)] || 'Cosmic'
  const noun = nouns[Math.floor(Math.random() * nouns.length)] || 'Blob'
  return `${adj}${noun}`
}

function generatePersonality(): string {
  const personalities = ['playful', 'wise', 'mischievous', 'gentle', 'energetic', 'calm', 'curious', 'brave']
  return personalities[Math.floor(Math.random() * personalities.length)] || 'playful'
}

const buddy = {
  name: 'buddy',
  description: 'Hatch and interact with your companion',
  type: 'local-jsx' as const,
  load: async () => ({ call }),
} satisfies Command

export default buddy
