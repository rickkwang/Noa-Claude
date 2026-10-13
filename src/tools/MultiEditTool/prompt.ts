import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'
import { MAX_EDITS_PER_CALL, MULTI_EDIT_TOOL_NAME } from './constants.js'

export function getMultiEditToolDescription(): string {
  return `Apply several exact-string replacements to one file in a single atomic call.

Usage:
- Use this instead of multiple ${FILE_EDIT_TOOL_NAME} calls on the same file. Either every edit applies or none does; the file is written once.
- Edits run in order against the result of the edits before them. A later old_string may not be a substring of text an earlier edit inserted; merge those into one edit instead.
- Each old_string must match exactly one location in the file at that point, unless replace_all is true.
- You must Read the file first, the same as ${FILE_EDIT_TOOL_NAME}.
- Up to ${MAX_EDITS_PER_CALL} edits per call. To create a new file, pass an empty old_string in the first edit.
- Do not use ${MULTI_EDIT_TOOL_NAME} for notebooks (.ipynb); use NotebookEdit.`
}
