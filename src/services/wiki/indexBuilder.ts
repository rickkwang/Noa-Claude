// @ts-nocheck
import { readFile, writeFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  getWikiPagesDir,
  getWikiSourcesDir,
  getWikiIndexPath,
  type WikiIndex,
  type WikiPage,
  type WikiSource,
} from './init.js'

export async function buildIndex(): Promise<{ success: boolean; message: string }> {
  try {
    const pagesDir = getWikiPagesDir()
    const sourcesDir = getWikiSourcesDir()
    const indexPath = getWikiIndexPath()

    const pages: WikiPage[] = []
    const sources: WikiSource[] = []

    // Read all page files
    try {
      const pageFiles = await readdir(pagesDir)
      for (const pageFile of pageFiles) {
        if (!pageFile.endsWith('.json')) continue
        const pagePath = join(pagesDir, pageFile)
        const pageContent = await readFile(pagePath, 'utf-8')
        const page = JSON.parse(pageContent) as WikiPage
        pages.push(page)
      }
    } catch {
      // Pages directory doesn't exist yet
    }

    // Read all source files
    try {
      const sourceFiles = await readdir(sourcesDir)
      for (const sourceFile of sourceFiles) {
        const sourcePath = join(sourcesDir, sourceFile)
        const sourceStat = await stat(sourcePath)
        // Read metadata from corresponding page if exists
        const pageId = sourceFile.replace(/\.[^.]+$/, '')
        const pagePath = join(pagesDir, `${pageId}.json`)
        let pageData: WikiPage | null = null
        try {
          const pageContent = await readFile(pagePath, 'utf-8')
          pageData = JSON.parse(pageContent)
        } catch {
          // No corresponding page
        }

        const source: WikiSource = {
          id: pageId,
          title: pageData?.title || sourceFile,
          path: sourcePath,
          ingestedAt: pageData?.updatedAt || sourceStat.mtime.toISOString(),
          summary: '',
          excerpt: '',
        }
        sources.push(source)
      }
    } catch {
      // Sources directory doesn't exist yet
    }

    // Sort sources by ingestedAt descending
    sources.sort(
      (a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime(),
    )

    const index: WikiIndex = {
      pages,
      sources,
    }

    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8')

    return {
      success: true,
      message: `Index built: ${pages.length} pages, ${sources.length} sources`,
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to build index: ${error}`,
    }
  }
}

export async function getIndex(): Promise<WikiIndex> {
  const indexPath = getWikiIndexPath()

  try {
    const indexContent = await readFile(indexPath, 'utf-8')
    return JSON.parse(indexContent)
  } catch {
    return { pages: [], sources: [] }
  }
}
