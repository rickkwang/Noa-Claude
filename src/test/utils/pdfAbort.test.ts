import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmp = mkdtempSync(join(tmpdir(), 'pdf-abort-'))
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'config')

const { extractPDFPages, isPdftoppmAvailable } = await import(
  '../../utils/pdf.js'
)
const { getToolResultsDir } = await import('../../utils/toolResultStorage.js')

afterAll(() => {
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  rmSync(tmp, { recursive: true, force: true })
})

// Smallest well-formed one-page PDF; xref offsets are computed below.
function writeOnePagePdf(path: string): void {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(path, body)
}

describe('extractPDFPages abort', () => {
  test('an aborted read stops pdftoppm and leaves no output dir', async () => {
    if (!(await isPdftoppmAvailable())) return
    const pdf = join(tmp, 'one.pdf')
    writeOnePagePdf(pdf)

    const controller = new AbortController()
    controller.abort()
    const started = Date.now()
    const result = await extractPDFPages(pdf, {
      firstPage: 1,
      lastPage: 1,
      abortSignal: controller.signal,
    })

    expect(result.success).toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
    const leftovers = (() => {
      try {
        return readdirSync(getToolResultsDir())
      } catch {
        return []
      }
    })()
    expect(leftovers.filter(n => n.startsWith('pdf-'))).toEqual([])
  })

  test('an unaborted read still renders the page', async () => {
    if (!(await isPdftoppmAvailable())) return
    const pdf = join(tmp, 'two.pdf')
    writeOnePagePdf(pdf)
    const result = await extractPDFPages(pdf, {
      firstPage: 1,
      lastPage: 1,
      abortSignal: new AbortController().signal,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.file.count).toBe(1)
  })
})
