// @ts-nocheck
// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's product config folder
export const PRODUCT_CONFIG_FOLDER_PERMISSION_PATTERN = '/.claude-agent/**'

// Permission pattern for granting session-level access to the project's legacy Claude config folder
export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.claude/**'

// Permission pattern for granting session-level access to the global product config folder
export const GLOBAL_PRODUCT_CONFIG_FOLDER_PERMISSION_PATTERN =
  '~/.claude-agent/**'

// Permission pattern for granting session-level access to the global legacy Claude config folder
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
