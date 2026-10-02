// @ts-nocheck
// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's product config folder
export const PRODUCT_CONFIG_FOLDER_PERMISSION_PATTERN = '/.noa/**'

// Permission pattern for granting session-level access to the global product config folder
export const GLOBAL_PRODUCT_CONFIG_FOLDER_PERMISSION_PATTERN =
  '~/.noa/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'

// Appended to a successful Edit/Write result so the model does not spend a
// turn reading the file back.
export const FILE_STATE_CURRENT_NOTE =
  ' (file state is current in your context — no need to Read it back)'
