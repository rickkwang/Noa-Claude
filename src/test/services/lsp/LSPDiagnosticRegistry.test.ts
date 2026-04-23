import { afterEach, describe, expect, test } from 'bun:test'
import {
  checkForLSPDiagnostics,
  registerPendingLSPDiagnostic,
  resetAllLSPDiagnosticState,
} from '../../../services/lsp/LSPDiagnosticRegistry.js'

describe('LSPDiagnosticRegistry deduplication', () => {
  afterEach(() => {
    resetAllLSPDiagnosticState()
  })

  test('deduplicates diagnostics by URI/content without relying on find non-null assertions', () => {
    const fileUri = 'file:///tmp/example.ts'
    const diagnostic = {
      message: 'Example error',
      severity: 'Error',
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 5 },
      },
      source: 'tsserver',
      code: 'E100',
    } as const

    registerPendingLSPDiagnostic({
      serverName: 'ts',
      files: [{ uri: fileUri, diagnostics: [diagnostic as any] }],
    })
    registerPendingLSPDiagnostic({
      serverName: 'ts',
      files: [{ uri: fileUri, diagnostics: [diagnostic as any] }],
    })

    const results = checkForLSPDiagnostics()
    expect(results.length).toBe(1)
    expect(results[0]?.files.length).toBe(1)
    expect(results[0]?.files[0]?.uri).toBe(fileUri)
    expect(results[0]?.files[0]?.diagnostics.length).toBe(1)
  })

  test('filters already delivered diagnostics across turns', () => {
    const fileUri = 'file:///tmp/example.ts'
    const diagnostic = {
      message: 'Persistent warning',
      severity: 'Warning',
      range: {
        start: { line: 2, character: 1 },
        end: { line: 2, character: 4 },
      },
      source: 'eslint',
      code: 'W200',
    } as const

    registerPendingLSPDiagnostic({
      serverName: 'eslint',
      files: [{ uri: fileUri, diagnostics: [diagnostic as any] }],
    })
    const first = checkForLSPDiagnostics()
    expect(first.length).toBe(1)
    expect(first[0]?.files[0]?.diagnostics.length).toBe(1)

    registerPendingLSPDiagnostic({
      serverName: 'eslint',
      files: [{ uri: fileUri, diagnostics: [diagnostic as any] }],
    })
    const second = checkForLSPDiagnostics()
    expect(second.length).toBe(0)
  })
})
