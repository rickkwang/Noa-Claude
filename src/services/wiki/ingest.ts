// @ts-nocheck
import { readFile, writeFile, copyFile, mkdir } from 'fs/promises'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import { getUserScopedSubdir } from '../../utils/productPaths.js'
import {
  getWikiPagesDir,
  getWikiSourcesDir,
  getWikiIndexPath,
  getWikiLogPath,
  type WikiSource,
  type WikiPage,
  type WikiIndex,
} from './init.js'

const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.pdf', '.html']

function generateExcerpt(content: string, maxLength: number = 200): string {
  // Remove frontmatter
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, '')
  // Remove markdown syntax
  const plainText = withoutFrontmatter
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .trim()

  if (plainText.length <= maxLength) {
    return plainText
  }
  return plainText.substring(0, maxLength).trim() + '...'
}

function generateSummary(content: string): string {
  const excerpt = generateExcerpt(content, 300)
  // Take first sentence or first 100 chars as summary
  const firstSentence = excerpt.match(/^[^.!?]+[.!?]/)?.[0] || excerpt.substring(0, 100)
  return firstSentence.trim()
}

function extractTitle(content: string, filePath: string): string {
  // Try to get title from frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const titleMatch = frontmatterMatch[1].match(/^title:\s*(.+)$/m)
    if (titleMatch) {
      return titleMatch[1].replace(/^["']|["']$/g, '').trim()
    }
  }

  // Try to get title from first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) {
    return h1Match[1].trim()
  }

  // Fall back to filename
  return basename(filePath, extname(filePath))
}

export async function ingestFile(
  filePath: string,
): Promise<{ success: boolean; message: string; source?: WikiSource }> {
  try {
    const filename = basename(filePath)
    const ext = extname(filePath).toLowerCase()

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return {
        success: false,
        message: `Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      }
    }

    const content = await readFile(filePath, 'utf-8')
    const title = extractTitle(content, filePath)
    const id = randomUUID()
    const ingestedAt = new Date().toISOString()
    const summary = generateSummary(content)
    const excerpt = generateExcerpt(content)

    // Create source file
    const sourceFilename = `${id}${ext}`
    const sourcePath = join(getWikiSourcesDir(), sourceFilename)
    await mkdir(getWikiSourcesDir(), { recursive: true })
    await copyFile(filePath, sourcePath)

    // Create page entry
    const pageId = randomUUID()
    const pagePath = join(getWikiPagesDir(), `${pageId}.json`)
    const page: WikiPage = {
      id: pageId,
      title,
      path: sourcePath,
      updatedAt: ingestedAt,
    }
    await mkdir(getWikiPagesDir(), { recursive: true })
    await writeFile(pagePath, JSON.stringify(page, null, 2), 'utf-8')

    // Update index.json
    const indexPath = getWikiIndexPath()
    let index: WikiIndex = { pages: [], sources: [] }
    try {
      const existingIndex = await readFile(indexPath, 'utf-8')
      index = JSON.parse(existingIndex)
    } catch {
      // Index doesn't exist yet, use default empty
    }

    const source: WikiSource = {
      id,
      title,
      path: sourcePath,
      ingestedAt,
      summary,
      excerpt,
    }

    index.pages.push(page)
    index.sources.push(source)
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')

    // Append to log.md
    const logPath = getWikiLogPath()
    let logContent = ''
    try {
      logContent = await readFile(logPath, 'utf-8')
    } catch {
      logContent = '# Wiki Log\n\n'
    }
    logContent += `\n## ${title}\n`
    logContent += `- Ingested: ${ingestedAt}\n`
    logContent += `- Source: ${filePath}\n`
    logContent += `- ID: ${id}\n`
    logContent += `- Summary: ${summary}\n`
    await writeFile(logPath, logContent, 'utf-8')

    return {
      success: true,
      message: `Ingested: ${title}`,
      source,
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to ingest ${filePath}: ${error}`,
    }
  }
}

export async function getWikiStatus(): Promise<{
  rootPath: string
  pageCount: number
  sourceCount: number
  lastUpdated: string | null
}> {
  const indexPath = getWikiIndexPath()

  try {
    const indexContent = await readFile(indexPath, 'utf-8')
    const index: WikiIndex = JSON.parse(indexContent)

    const lastSource = index.sources
      .sort((a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime())[0]

    return {
      rootPath: getUserScopedSubdir('wiki'),
      pageCount: index.pages.length,
      sourceCount: index.sources.length,
      lastUpdated: lastSource?.ingestedAt || null,
    }
  } catch {
    return {
      rootPath: getUserScopedSubdir('wiki'),
      pageCount: 0,
      sourceCount: 0,
      lastUpdated: null,
    }
  }
}
