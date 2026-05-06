export type McpbUserConfigurationOption = {
  type?: 'string' | 'number' | 'boolean' | 'file' | 'directory';
  title?: string;
  required?: boolean;
  multiple?: boolean;
  sensitive?: boolean;
  min?: number;
  max?: number;
};

export type McpbManifest = {
  name: string;
  version?: string;
  author: { name: string };
  server?: unknown;
  user_config?: Record<string, McpbUserConfigurationOption>;
};

export const McpbManifestSchema: {
  safeParse(manifest: unknown):
    | { success: true; data: McpbManifest }
    | {
        success: false;
        error: {
          flatten(): {
            fieldErrors: Record<string, string[]>;
            formErrors: string[];
          };
        };
      };
};

export function getMcpConfigForManifest(manifest: {
  manifest: McpbManifest;
  extensionPath: string;
  systemDirs: unknown;
  userConfig?: Record<string, unknown>;
  pathSeparator?: string;
}): Promise<{ servers: unknown[] } | null>;
