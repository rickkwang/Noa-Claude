import * as React from 'react'
import { useEffect, useState } from 'react'
import { readFile } from 'fs/promises'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import type { SessionEntry } from '../../utils/background/sessionRegistry.js'
import { formatRelativeTime } from '../../utils/background/sessionRegistry.js'

type Props = {
  session: SessionEntry
  onBack: () => void
}

export function SessionDetail({ session, onBack }: Props): React.ReactNode {
  const [logTail, setLogTail] = useState<string[] | null>(null)

  useEffect(() => {
    if (!session.logPath) return
    let cancelled = false
    void readFile(session.logPath, 'utf8')
      .then(contents => {
        if (cancelled) return
        const lines = contents.trimEnd().split('\n')
        setLogTail(lines.slice(Math.max(0, lines.length - 20)))
      })
      .catch(() => { if (!cancelled) setLogTail(null) })
    return () => { cancelled = true }
  }, [session.logPath])

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={(e: KeyboardEvent) => {
      if (e.key === 'escape' || e.key === 'return') {
        e.preventDefault()
        onBack()
      }
    }}>
      <Box flexDirection="column" gap={0} marginBottom={1}>
        <Box>
          <Text dimColor>PID:       </Text>
          <Text>{session.pid}</Text>
          <Text dimColor>  ({session.alive ? 'running' : 'stopped'})</Text>
        </Box>
        {session.sessionId && (
          <Box>
            <Text dimColor>Session:   </Text>
            <Text>{session.sessionId}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Kind:      </Text>
          <Text>{session.kind ?? 'interactive'}</Text>
        </Box>
        {session.cwd && (
          <Box>
            <Text dimColor>Directory: </Text>
            <Text>{session.cwd}</Text>
          </Box>
        )}
        {session.agent && (
          <Box>
            <Text dimColor>Agent:     </Text>
            <Text>{session.agent}</Text>
          </Box>
        )}
        {session.startedAt && (
          <Box>
            <Text dimColor>Started:   </Text>
            <Text>{formatRelativeTime(session.startedAt)} ago</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>State:     </Text>
          <Text>{session.derivedState}</Text>
          {session.waitingFor && (
            <Text color="yellow"> ({session.waitingFor})</Text>
          )}
        </Box>
      </Box>

      {session.logPath && logTail && logTail.length > 0 && (
        <Box flexDirection="column">
          <Text bold dimColor>Recent log output:</Text>
          <Box flexDirection="column" marginTop={0} paddingLeft={1}>
            {logTail.map((line, i) => (
              <Text key={i} dimColor wrap="truncate">
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {!session.logPath && (
        <Text dimColor italic>No log path recorded for this session.</Text>
      )}
    </Box>
  )
}
