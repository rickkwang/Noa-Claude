export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  dataBase64?: string;
  vaultPath?: string;
}

export type NoteSource = 'noa' | 'obsidian-import';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  folder: string;
  tags: string[];
  links: string[];
  linkRefs: string[];
  attachments?: Attachment[];
  source?: NoteSource;
  origin?: 'vault';
  vaultId?: string;
  vaultPath?: string;
  /** Internal cache marker: local vault edits must reach disk before an
   * authoritative scan may replace this row. Never trusted from imports. */
  vaultDirty?: boolean;
  /** Exact Markdown payload last read from or confirmed on disk. Clean rows
   * keep it only when the disk bytes cannot be reconstructed canonically. */
  vaultBaseText?: string;
  frontmatter?: Record<string, unknown>;
  /** Raw YAML lines of the original frontmatter (without --- delimiters), kept verbatim so vault sync never rewrites them. */
  rawFrontmatter?: string;
  /** Original frontmatter line ending; needed for byte-exact round trips of single-line blocks. */
  frontmatterEol?: '\n' | '\r\n';
}

/** The exact note fields confirmed by one successful vault write. */
export interface VaultSyncedNoteExpectation {
  id: string;
  content?: string;
  title?: string;
  folder?: string;
  updatedAt?: string;
  /** Exact non-canonical payload confirmed by a byte-preserving structural
   * write. Omit after canonical writes so the reconstructable baseline clears. */
  confirmedVaultBaseText?: string;
}

export interface Folder {
  id: string;
  name: string;
  source?: NoteSource;
  origin?: 'vault';
  vaultPath?: string;
}

export type VaultPendingOperation =
  | {
      key: string;
      entityKey: string;
      kind: 'delete-note';
      vaultId?: string;
      phase?: 'prepared' | 'committed';
      note: Note;
      folders: Folder[];
    }
  | {
      key: string;
      entityKey: string;
      kind: 'rename-folder';
      vaultId?: string;
      phase?: 'prepared' | 'committed';
      folderId: string;
      previousName: string;
      nextFolders: Folder[];
    }
  | {
      key: string;
      entityKey: string;
      kind: 'delete-folder';
      vaultId?: string;
      phase?: 'prepared' | 'committed';
      folder: Folder;
    };

export type BackupHealthStatus = 'healthy' | 'warning' | 'risk';
export type RecoveryAction = 'retry' | 'import_backup' | 'reset_workspace';
export type AppErrorCode =
  | 'storage_unavailable'
  | 'import_invalid_json'
  | 'import_integrity_failed'
  | 'import_replace_risky'
  | 'sync_permission_denied'
  | 'unknown_error';

export type Priority = 'high' | 'medium' | 'low' | 'none';

export interface GlobalTask {
  id: string;
  noteId: string;
  noteTitle: string;
  content: string;
  taskId?: string;
  completed: boolean;
  dueDate?: string;
  priority: Priority;
  lineIndex: number;
  occurrenceIndex: number;
  originalString: string;
}

export interface UserTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

export type EmptyStateScene = 'island' | 'desk';

export interface AppSettings {
  editor: {
    fontSize: number;
    lineHeight: number;
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
    fontFamily: string;
    uiFontStyle: 'light' | 'light-italic' | 'regular' | 'regular-italic' | 'medium' | 'medium-italic' | 'semibold' | 'semibold-italic' | 'bold' | 'bold-italic';
    maxWidth: number;
    usePointerCursors: boolean;
    translucentSidebar: boolean;
    reduceMotion: boolean;
    uiFontSize: number;
    codeFontSize: number;
    fontSmoothing: boolean;
    emptyStateScene: EmptyStateScene;
  };
  dailyNotes: {
    template: string;
    dateFormat: string;
  };
  search: {
    caseSensitive: boolean;
    fuzzySearch: boolean;
  };
  corePlugins: {
    dailyNotes: boolean;
  };
  templates: {
    userTemplates: UserTemplate[];
  };
  backup: {
    autoBackupEnabled: boolean;
  };
  agent: {
    defaultPermissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  };
}

export type SyncStatus = 'idle' | 'syncing' | 'ready' | 'error';

export interface NoteSnapshot {
  noteId: string;
  content: string;
  title: string;
  savedAt: string; // ISO string
}
