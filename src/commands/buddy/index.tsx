// @ts-nocheck
import * as React from 'react'
import { randomBytes } from 'crypto'
import { feature } from 'bun:bundle'
import type { Command } from '../../types/command.js'
import type { LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js'
import { BuddyCard } from '../../buddy/BuddyCard.js'
import { companionUserId, getCompanion, roll, rollWithSeed } from '../../buddy/companion.js'
import { saveGlobalConfig } from '../../utils/config.js'
import {
  EYES,
  HATS,
  RARITIES,
  SPECIES,
  type CompanionStyle,
} from '../../buddy/types.js'

const speciesSet = new Set(SPECIES)
const raritySet = new Set(RARITIES)
const hatSet = new Set(HATS)
const eyeSet = new Set(EYES)

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

  if (arg?.startsWith('reroll')) {
    const trimmedArgs = args?.trim() ?? ''
    const styleArgs = trimmedArgs.slice('reroll'.length).trim()
    const currentCompanion = rerollCompanion(parseBuddyStyle(styleArgs))
    return <BuddyCard companion={currentCompanion} onClose={() => onDone('Buddy dismissed', { display: 'system' })} />
  }

  const currentCompanion = companion ?? hatchCompanion()
  if (!currentCompanion) {
    onDone('Failed to hatch a companion')
    return null
  }

  return <BuddyCard companion={currentCompanion} onClose={() => onDone('Buddy dismissed', { display: 'system' })} />
}

function generateName(): string {
  const adjectives = ['Fluffy', 'Tiny', 'Cosmic', 'Mystic', 'Shadow', 'Golden', 'Silver', 'Ancient', 'Wild']
  const nouns = ['Duck', 'Goose', 'Blob', 'Cat', 'Dragon', 'Octopus', 'Owl', 'Penguin', 'Turtle', 'Snail', 'Ghost', 'Capybara', 'Cactus', 'Robot', 'Rabbit']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)] || 'Cosmic'
  const noun = nouns[Math.floor(Math.random() * nouns.length)] || 'Blob'
  return `${adj}${noun}`
}

function hatchCompanion(style?: CompanionStyle) {
  const userId = companionUserId()
  const { bones } = roll(userId, style)
  const name = generateName()
  const hatchedAt = Date.now()
  const soul = {
    name,
    personality: generatePersonality(),
    hatchedAt,
  }

  saveGlobalConfig(prev => ({
    ...prev,
    companion: soul,
  }))

  return { ...bones, ...soul }
}

function rerollCompanion(style?: CompanionStyle) {
  const seed = randomBytes(16).toString('hex')
  const { bones } = rollWithSeed(seed, style)
  const name = generateName()
  const hatchedAt = Date.now()
  const soul = {
    name,
    personality: generatePersonality(),
    hatchedAt,
    rerollSeed: seed,
    rerollStyle: style,
  }

  saveGlobalConfig(prev => ({
    ...prev,
    companion: soul,
  }))

  return { ...bones, name, personality: soul.personality, hatchedAt }
}

function parseBuddyStyle(input: string): CompanionStyle | undefined {
  const tokens = input
    .split(/[\s,]+/)
    .map(token => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) return undefined

  const style: CompanionStyle = {}

  for (const rawToken of tokens) {
    const [rawKey, rawValue] = rawToken.split('=')
    const key = rawValue ? rawKey.toLowerCase() : rawToken.toLowerCase()
    const value = rawValue?.toLowerCase()
    const candidate = value ?? key

    if (candidate === 'shiny') {
      style.shiny = true
      continue
    }

    if (candidate === 'plain' || candidate === 'normal' || candidate === 'notshiny' || candidate === 'no-shiny') {
      style.shiny = false
      continue
    }

    if (raritySet.has(candidate as (typeof RARITIES)[number])) {
      style.rarity = candidate as (typeof RARITIES)[number]
      continue
    }

    if (speciesSet.has(candidate as (typeof SPECIES)[number])) {
      style.species = candidate as (typeof SPECIES)[number]
      continue
    }

    if (hatSet.has(candidate as (typeof HATS)[number])) {
      style.hat = candidate as (typeof HATS)[number]
      continue
    }

    if (eyeSet.has(candidate as (typeof EYES)[number])) {
      style.eye = candidate as (typeof EYES)[number]
      continue
    }

    if (rawValue) {
      switch (key) {
        case 'species':
        case 'style':
          if (speciesSet.has(candidate as (typeof SPECIES)[number])) {
            style.species = candidate as (typeof SPECIES)[number]
          }
          break
        case 'rarity':
          if (raritySet.has(candidate as (typeof RARITIES)[number])) {
            style.rarity = candidate as (typeof RARITIES)[number]
          }
          break
        case 'hat':
          if (hatSet.has(candidate as (typeof HATS)[number])) {
            style.hat = candidate as (typeof HATS)[number]
          }
          break
        case 'eye':
          if (eyeSet.has(candidate as (typeof EYES)[number])) {
            style.eye = candidate as (typeof EYES)[number]
          }
          break
        case 'shiny':
          style.shiny = candidate !== 'false' && candidate !== '0' && candidate !== 'no'
          break
      }
    }
  }

  return Object.keys(style).length > 0 ? style : undefined
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
