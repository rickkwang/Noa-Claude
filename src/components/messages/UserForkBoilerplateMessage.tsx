import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
  verbose?: boolean
}

// <fork-boilerplate>…</fork-boilerplate>Your directive: <directive>
// The worker rules are model-facing; the transcript shows only the directive.
const FORK_RE = new RegExp(
  `<${FORK_BOILERPLATE_TAG}>[\\s\\S]*?</${FORK_BOILERPLATE_TAG}>\\n?${FORK_DIRECTIVE_PREFIX}([\\s\\S]*)$`,
)

export function parseForkDirective(text: string): string | null {
  const match = text.match(FORK_RE)
  return match?.[1] !== undefined ? match[1].trim() : null
}

export function UserForkBoilerplateMessage({ addMargin, param, verbose }: Props) {
  const directive = parseForkDirective(param.text)
  // Never hide the message: if the tag doesn't parse, show the raw text.
  if (directive === null) {
    return <Box flexDirection="column" marginTop={addMargin ? 1 : 0}><Text>{param.text}</Text></Box>
  }
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text dimColor={true}>fork ▸ </Text>
        {verbose ? param.text : directive}
      </Text>
    </Box>
  )
}
