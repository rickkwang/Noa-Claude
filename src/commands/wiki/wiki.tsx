// @ts-nocheck
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { initWiki, getWikiRootDir } from '../../services/wiki/init.js'
import { ingestFile, getWikiStatus } from '../../services/wiki/ingest.js'
import { buildIndex } from '../../services/wiki/indexBuilder.js'

function WikiStatus(): React.ReactNode {
  const [status, setStatus] = React.useState<{
    rootPath: string
    pageCount: number
    sourceCount: number
    lastUpdated: string | null
  } | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    getWikiStatus().then(s => {
      setStatus(s)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Loading wiki status...</Text>
      </Box>
    )
  }

  if (!status) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Failed to load wiki status</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Wiki Status</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text>Root: {status.rootPath}</Text>
        <Text>Pages: {status.pageCount}</Text>
        <Text>Sources: {status.sourceCount}</Text>
        <Text>
          Last updated:{' '}
          {status.lastUpdated
            ? new Date(status.lastUpdated).toLocaleString()
            : 'Never'}
        </Text>
      </Box>
    </Box>
  )
}

function WikiInit({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: 'system' }) => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<'init' | 'done' | 'error'>('init')
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    initWiki().then(result => {
      setMessage(result.message)
      setStatus(result.success ? 'done' : 'error')
      setTimeout(() => {
        onDone(result.message, { display: 'system' })
      }, 1000)
    })
  }, [onDone])

  return (
    <Box flexDirection="column" padding={1}>
      {status === 'init' && <Text>Initializing wiki...</Text>}
      {status === 'done' && <Text color="green">{message}</Text>}
      {status === 'error' && <Text color="red">{message}</Text>}
    </Box>
  )
}

function WikiIngest({
  path,
  onDone,
}: {
  path: string
  onDone: (result?: string, options?: { display?: 'system' }) => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<'ingest' | 'done' | 'error'>('ingest')
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    if (!path) {
      setStatus('error')
      setMessage('Please provide a path to ingest')
      return
    }

    ingestFile(path).then(result => {
      setMessage(result.message)
      if (result.success) {
        // Rebuild index after ingest
        return buildIndex()
      }
      throw new Error(result.message)
    }).then(result => {
      if (result && !result.success) {
        setStatus('error')
        setMessage(result.message)
      } else {
        setStatus('done')
      }
      setTimeout(() => {
        onDone(result?.success ? `${message}. ${result?.message}` : message, {
          display: 'system',
        })
      }, 1000)
    }).catch(err => {
      setStatus('error')
      setMessage(err.message || 'Failed to ingest file')
    })
  }, [path, onDone, message])

  return (
    <Box flexDirection="column" padding={1}>
      {status === 'ingest' && <Text>Ingesting {path}...</Text>}
      {status === 'done' && <Text color="green">{message}</Text>}
      {status === 'error' && <Text color="red">{message}</Text>}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (
  onDone,
  _context,
  args,
): Promise<React.ReactNode> => {
  const trimmedArgs = args.trim()

  if (!trimmedArgs) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Wiki Commands</Text>
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text>/wiki init - Initialize wiki structure</Text>
          <Text>/wiki status - Show wiki status</Text>
          <Text>/wiki ingest &lt;path&gt; - Ingest a file</Text>
        </Box>
      </Box>
    )
  }

  const [command, ...commandArgs] = trimmedArgs.split(/\s+/)
  const subCommand = command.toLowerCase()
  const pathArg = commandArgs.join(' ')

  switch (subCommand) {
    case 'init':
      return <WikiInit onDone={onDone} />

    case 'status':
      return <WikiStatus />

    case 'ingest':
      if (!pathArg) {
        onDone('Please provide a path to ingest', { display: 'system' })
        return (
          <Box flexDirection="column" padding={1}>
            <Text color="yellow">Usage: /wiki ingest &lt;path&gt;</Text>
          </Box>
        )
      }
      return <WikiIngest path={pathArg} onDone={onDone} />

    default:
      onDone(`Unknown wiki command: ${command}`, { display: 'system' })
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="red">Unknown command: {command}</Text>
          <Text dimColor>Use: init, status, or ingest</Text>
        </Box>
      )
  }
}
