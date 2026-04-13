// @ts-nocheck
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export interface WikiSchema {
  version: string
  createdAt: string
}

export interface WikiPage {
  id: string
  title: string
  path: string
  updatedAt: string
}

export interface WikiSource {
  id: string
  title: string
  path: string
  ingestedAt: string
  summary: string
  excerpt: string
}

export interface WikiIndex {
  pages: WikiPage[]
  sources: WikiSource[]
}

export function getWikiRootDir(): string {
  return join(getClaudeConfigHomeDir(), 'wiki')
}

export function getWikiPagesDir(): string {
  return join(getWikiRootDir(), 'pages')
}

export function getWikiSourcesDir(): string {
  return join(getWikiRootDir(), 'sources')
}

export function getWikiSchemaPath(): string {
  return join(getWikiRootDir(), 'schema.json')
}

export function getWikiIndexPath(): string {
  return join(getWikiRootDir(), 'index.json')
}

export function getWikiLogPath(): string {
  return join(getWikiRootDir(), 'log.md')
}

export async function initWiki(): Promise<{ success: boolean; message: string }> {
  const wikiRoot = getWikiRootDir()
  const pagesDir = getWikiPagesDir()
  const sourcesDir = getWikiSourcesDir()
  const schemaPath = getWikiSchemaPath()
  const indexPath = getWikiIndexPath()
  const logPath = getWikiLogPath()

  try {
    // Create directories
    await mkdir(pagesDir, { recursive: true })
    await mkdir(sourcesDir, { recursive: true })

    // Create schema.json if it doesn't exist
    try {
      await readFile(schemaPath, 'utf-8')
    } catch {
      const schema: WikiSchema = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
      }
      await writeFile(schemaPath, JSON.stringify(schema, null, 2), 'utf-8')
    }

    // Create index.json if it doesn't exist
    try {
      await readFile(indexPath, 'utf-8')
    } catch {
      const index: WikiIndex = {
        pages: [],
        sources: [],
      }
      await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')
    }

    // Create log.md if it doesn't exist
    try {
      await readFile(logPath, 'utf-8')
    } catch {
      const logContent = `# Wiki Log\n\nWiki initialized at ${new Date().toISOString()}\n`
      await writeFile(logPath, logContent, 'utf-8')
    }

    return {
      success: true,
      message: `Wiki initialized at ${wikiRoot}`,
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to initialize wiki: ${error}`,
    }
  }
}
