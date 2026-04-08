// @ts-nocheck
import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { ProgressBar } from '../components/design-system/ProgressBar.js'
import { renderSprite } from './sprites.js'
import {
  RARITY_COLORS,
  RARITY_STARS,
  STAT_NAMES,
  type Companion,
  type StatName,
} from './types.js'

type Props = {
  companion: Companion
  onClose: () => void
}

const STAT_COLOR: keyof import('../utils/theme.js').Theme = 'inactive'
const STAT_TRACK_COLOR: keyof import('../utils/theme.js').Theme = 'subtle'

function maxStat(companion: Companion): StatName {
  return STAT_NAMES.reduce((best, stat) =>
    companion.stats[stat] > companion.stats[best] ? stat : best,
  )
}

function minStat(companion: Companion): StatName {
  return STAT_NAMES.reduce((worst, stat) =>
    companion.stats[stat] < companion.stats[worst] ? stat : worst,
  )
}

function formatFlavor(companion: Companion): string {
  const top = maxStat(companion).toLowerCase()
  const flop = minStat(companion).toLowerCase()
  const personality = companion.personality

  const speciesLines: Record<string, string> = {
    rabbit:
      'A restless rabbit that can sit perfectly still right up until the moment it spots something shiny.',
    cat:
      'A suspicious cat that reviews every move, then acts as if it invented the idea first.',
    duck:
      'A duck with an engineer’s persistence and an alarming ability to turn any hallway into a runway.',
    goose:
      'A goose that treats debugging as a contact sport and input latency as a personal insult.',
    dragon:
      'A dragon-sized personality in a compact frame, mostly interested in dramatic exits.',
    owl:
      'An owl that will stare into the bug until the bug apologizes or disappears.',
    robot:
      'A tiny automaton that approaches every mystery like it expects a reward at the end.',
    capybara:
      'A calm companion who makes chaos feel temporary and insists that most things can wait.',
  }

  const fallback = `A ${personality} ${companion.species} that favors ${top} and keeps ${flop} on a short leash.`
  return speciesLines[companion.species] ?? fallback
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function StatRow({ name, value, color }) {
  return (
    <Box flexDirection="row" alignItems="center" gap={2}>
      <Text dimColor={true}>
        {name.padEnd(12)}
      </Text>
      <Box flexGrow={1}>
        <ProgressBar ratio={value / 100} width={14} fillColor={color} emptyColor={STAT_TRACK_COLOR} />
      </Box>
      <Text dimColor={true}>{String(value).padStart(3)}</Text>
    </Box>
  )
}

export function BuddyCard({ companion, onClose }: Props) {
  useKeybinding('confirm:no', onClose, { context: 'Confirmation' })
  const sprite = renderSprite(companion, 0)
  const stars = RARITY_STARS[companion.rarity]
  const shiny = companion.shiny ? ' ✨ SHINY' : ''
  const headerColor = RARITY_COLORS[companion.rarity]
  const flavor = formatFlavor(companion)
  const title = companion.species.toUpperCase()
  const subtitle = `${companion.personality} · hatched ${new Date(companion.hatchedAt).toLocaleDateString()}`
  const flavorLines = wrapText(flavor, 34)

  return (
    <Box borderStyle="round" borderColor={headerColor} flexDirection="column" paddingX={1} paddingY={1} gap={0} width={42}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold={true} color={headerColor}>
          {`${stars} ${companion.rarity.toUpperCase()}`}
        </Text>
        <Text bold={true} dimColor={true}>
          {title}
        </Text>
      </Box>
      <Box flexDirection="column" alignItems="center" marginTop={0}>
        <Box flexDirection="column" alignItems="center" width={14}>
          {sprite.map((line, i) => (
            <Text key={i} color={i === 0 && companion.shiny ? 'warning' : headerColor}>
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" alignItems="center" marginTop={1}>
          <Text bold={true}>{companion.name}</Text>
          <Text dimColor={true}>
            {subtitle}
            {shiny}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {flavorLines.map((line, i) => (
          <Text key={`flavor-${i}`} italic={true}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" gap={0} marginTop={1}>
        {STAT_NAMES.map(stat => (
          <StatRow
            key={stat}
            name={stat}
            value={companion.stats[stat]}
            color={STAT_COLOR}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor={true}>
          /buddy pet · /buddy mute · /buddy unmute
        </Text>
      </Box>
    </Box>
  )
}
