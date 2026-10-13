import { dirname } from 'path'
import { z } from 'zod/v4'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from '../../services/lsp/manager.js'
import { notifyVscodeFileUpdated } from '../../services/mcp/vscodeSdkMcp.js'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { countLinesChanged } from '../../utils/diff.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from '../../skills/loadSkillsDir.js'
import { isENOENT } from '../../utils/errors.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import { fileHistoryTrackEdit } from '../../utils/fileHistory.js'
import { logFileOperation } from '../../utils/fileOperationAnalytics.js'
import { type LineEndingType, readFileSyncWithMetadata } from '../../utils/fileRead.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import { checkWritePermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { checkTeamMemSecrets } from '../../services/teamMemorySync/teamMemSecretGuard.js'
import { checkWorktreeEscape } from '../../utils/worktreeEscape.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import { FILE_STATE_CURRENT_NOTE, FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../FileEditTool/constants.js'
import {
  findActualString,
  getPatchForEdit,
  getPatchForEdits,
  preserveQuoteStyle,
} from '../FileEditTool/utils.js'
import type { FileEdit } from '../FileEditTool/types.js'
import { canSkipPreRead } from '../shared/preReadGuard.js'
import {
  getToolUseSummary,
  renderToolResultMessage as renderFileEditResult,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from '../FileEditTool/UI.js'
import { getMultiEditToolDescription } from './prompt.js'
import { MAX_EDITS_PER_CALL, MULTI_EDIT_TOOL_NAME } from './constants.js'

const editSchema = z.strictObject({
  old_string: z.string().describe('The text to replace'),
  new_string: z
    .string()
    .describe('The text to replace it with (must be different from old_string)'),
  replace_all: semanticBoolean(
    z.boolean().default(false).optional(),
  ).describe('Replace all occurrences of old_string (default false)'),
})

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to modify'),
    edits: z
      .array(editSchema)
      .min(1)
      .max(MAX_EDITS_PER_CALL)
      .describe('Edits to apply in order; all apply or none do'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type MultiEditInput = z.output<InputSchema>
type Edit = z.output<typeof editSchema>

const outputSchema = lazySchema(() =>
  z.object({
    filePath: z.string(),
    originalFile: z.string(),
    structuredPatch: z.array(
      z.object({
        oldStart: z.number(),
        oldLines: z.number(),
        newStart: z.number(),
        newLines: z.number(),
        lines: z.array(z.string()),
      }),
    ),
    userModified: z.boolean(),
    inputModified: z.boolean().optional(),
    editCount: z.number(),
  }),
)
export type MultiEditOutput = z.infer<ReturnType<typeof outputSchema>>

// Resolves each edit against the content produced by the edits before it,
// the same quote handling FileEditTool applies to a single edit. Missing and
// non-unique matches throw here, naming the edit so the model can fix it.
function normalizeEdits(
  filePath: string,
  fileContents: string,
  edits: Edit[],
): { edits: FileEdit[]; updatedFile: string } {
  let current = fileContents
  const normalized = edits.map((edit, i) => {
    const replaceAll = edit.replace_all ?? false
    const oldString = findActualString(current, edit.old_string) || edit.old_string
    const newString = preserveQuoteStyle(edit.old_string, oldString, edit.new_string)
    try {
      current = getPatchForEdit({
        filePath,
        fileContents: current,
        oldString,
        newString,
        replaceAll,
      }).updatedFile
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(`Edit ${i + 1}: ${message}`)
    }
    return { old_string: oldString, new_string: newString, replace_all: replaceAll }
  })
  return { edits: normalized, updatedFile: current }
}

function applyEditsInMemory(filePath: string, fileContents: string, edits: Edit[]) {
  const normalized = normalizeEdits(filePath, fileContents, edits)
  return getPatchForEdits({
    filePath,
    fileContents,
    edits: normalized.edits,
  })
}

// Same read as FileEditTool's readFileForEdit (not exported there)
function readFileForEdit(absoluteFilePath: string): {
  content: string
  fileExists: boolean
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs
    const meta = readFileSyncWithMetadata(absoluteFilePath)
    return {
      content: meta.content,
      fileExists: true,
      encoding: meta.encoding,
      lineEndings: meta.lineEndings,
    }
  } catch (e) {
    if (isENOENT(e)) {
      return { content: '', fileExists: false, encoding: 'utf8', lineEndings: 'LF' }
    }
    throw e
  }
}

export const MultiEditTool = buildTool({
  name: MULTI_EDIT_TOOL_NAME,
  searchHint: 'apply several edits to one file atomically',
  maxResultSizeChars: 100_000,
  async description() {
    return 'A tool for applying several edits to one file atomically'
  },
  async prompt() {
    return getMultiEditToolDescription()
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Editing ${summary}` : 'Editing file'
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.edits.map(e => e.new_string).join(' ')}`
  },
  getPath(input): string {
    return input.file_path
  },
  backfillObservableInput(input) {
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  async preparePermissionMatcher({ file_path }) {
    return pattern => matchWildcardPattern(pattern, file_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    // Edit deny/allow rules apply to this tool too; rule matching is by path
    return checkWritePermissionForTool(
      MultiEditTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseMessage,
  renderToolResultMessage(output, progressMessages, options) {
    // The shared renderer only reads filePath, structuredPatch and originalFile
    return renderFileEditResult(
      { ...output, oldString: '', newString: '', replaceAll: false },
      progressMessages,
      options,
    )
  },
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  async validateInput(input: MultiEditInput, toolUseContext: ToolUseContext) {
    const { file_path, edits } = input
    const fullFilePath = expandPath(file_path)

    for (const [i, edit] of edits.entries()) {
      const secretError = checkTeamMemSecrets(fullFilePath, edit.new_string)
      if (secretError) {
        return { result: false, message: secretError, errorCode: 0 }
      }
      if (edit.old_string === edit.new_string) {
        return {
          result: false,
          behavior: 'ask',
          message: `No changes to make in edit ${i + 1}: old_string and new_string are exactly the same.`,
          errorCode: 1,
        }
      }
    }

    const escapeError = checkWorktreeEscape(fullFilePath)
    if (escapeError) {
      return { result: false, message: escapeError, errorCode: 11 }
    }

    // File-level checks (deny rules, size, read-before-edit, notebook, existence)
    // are FileEditTool's; run them once against the first edit.
    const [firstEdit] = edits
    if (!firstEdit) {
      return { result: false, message: 'No edits provided.', errorCode: 21 }
    }
    const fileLevel = await FileEditTool.validateInput(
      {
        file_path,
        old_string: firstEdit.old_string,
        new_string: firstEdit.new_string,
        replace_all: firstEdit.replace_all ?? false,
      },
      toolUseContext,
    )
    if (!fileLevel.result) {
      return fileLevel
    }

    // Dry-run every edit in memory so a bad edit rejects the whole call
    // before anything is written.
    const { content } = readFileForEdit(fullFilePath)
    try {
      applyEditsInMemory(fullFilePath, content, edits)
    } catch (e) {
      return {
        result: false,
        behavior: 'ask',
        message: `No changes were written. ${e instanceof Error ? e.message : String(e)}`,
        errorCode: 20,
      }
    }
    return { result: true }
  },
  async call(input: MultiEditInput, toolUseContext, _, parentMessage) {
    const { readFileState, userModified, updateFileHistoryState, dynamicSkillDirTriggers } = toolUseContext
    const { file_path, edits } = input

    const fs = getFsImplementation()
    const absoluteFilePath = expandPath(file_path)

    // Skip in simple mode - no skills available
    const cwd = getCwd()
    if (!isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
      const newSkillDirs = await discoverSkillDirsForPaths([absoluteFilePath], cwd)
      if (newSkillDirs.length > 0) {
        for (const dir of newSkillDirs) {
          dynamicSkillDirTriggers?.add(dir)
        }
        addSkillDirectories(newSkillDirs).catch(() => {})
      }
      activateConditionalSkillsForPaths([absoluteFilePath], cwd)
    }

    await diagnosticTracker.beforeFileEdited(absoluteFilePath)

    // Keep these awaits outside the read-modify-write section below.
    await fs.mkdir(dirname(absoluteFilePath))
    await fileHistoryTrackEdit(updateFileHistoryState, absoluteFilePath, parentMessage.uuid)

    // Atomic section: no awaits between the staleness check and the write.
    const {
      content: originalFileContents,
      fileExists,
      encoding,
      lineEndings,
    } = readFileForEdit(absoluteFilePath)

    if (fileExists) {
      const lastWriteTime = getFileModificationTime(absoluteFilePath)
      const lastRead = readFileState.get(absoluteFilePath)
      if (!lastRead) {
        if (!canSkipPreRead(MULTI_EDIT_TOOL_NAME, absoluteFilePath, toolUseContext)) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      } else if (lastWriteTime > lastRead.timestamp) {
        // Unlike FileEditTool there is no per-edit "still applies cleanly"
        // fallback: a stale multi-edit is rejected outright.
        const isFullRead = lastRead.offset === undefined && lastRead.limit === undefined
        const contentUnchanged = isFullRead && originalFileContents === lastRead.content
        if (!contentUnchanged) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    const { patch, updatedFile } = applyEditsInMemory(
      absoluteFilePath,
      originalFileContents,
      edits,
    )

    const writtenAt = writeTextContent(absoluteFilePath, updatedFile, encoding, lineEndings)

    const lspManager = getLspServerManager()
    if (lspManager) {
      clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
      lspManager.changeFile(absoluteFilePath, updatedFile).catch((err: Error) => {
        logError(err)
      })
      lspManager.saveFile(absoluteFilePath).catch((err: Error) => {
        logError(err)
      })
    }

    notifyVscodeFileUpdated(absoluteFilePath, originalFileContents, updatedFile)

    readFileState.set(absoluteFilePath, {
      content: updatedFile,
      timestamp: writtenAt,
      offset: undefined,
      limit: undefined,
    })

    countLinesChanged(patch)
    logFileOperation({
      operation: 'edit',
      tool: 'MultiEditTool',
      filePath: absoluteFilePath,
    })

    return {
      data: {
        filePath: file_path,
        originalFile: originalFileContents,
        structuredPatch: patch,
        userModified: userModified ?? false,
        inputModified: Boolean(toolUseContext.inputModified),
        editCount: edits.length,
      },
    }
  },
  mapToolResultToToolResultBlockParam(data: MultiEditOutput, toolUseID) {
    const { filePath, userModified, inputModified, editCount } = data
    const modifiedNote = userModified
      ? '.  The user modified your proposed changes before accepting them. '
      : ''
    const currentNote = userModified || inputModified ? '' : FILE_STATE_CURRENT_NOTE
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `The file ${filePath} has been updated with ${editCount} edit(s), all applied${modifiedNote}.${currentNote}`,
    }
  },
} satisfies ToolDef<InputSchema, MultiEditOutput>)
