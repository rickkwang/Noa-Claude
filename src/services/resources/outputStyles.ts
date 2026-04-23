// @ts-nocheck
import memoize from 'lodash-es/memoize.js';
import type { OutputStyleConfig } from '../../constants/outputStyles.js';
import {
  clearOutputStyleCaches,
  getOutputStyleDirStyles,
} from '../../outputStyles/loadOutputStylesDir.js';
import { loadPluginOutputStyles } from '../../utils/plugins/loadPluginOutputStyles.js';

export const loadOutputStyleResources = memoize(
  async (
    cwd: string,
  ): Promise<{
    customStyles: OutputStyleConfig[];
    pluginStyles: OutputStyleConfig[];
    mergedStyles: OutputStyleConfig[];
  }> => {
    const [customStyles, pluginStyles] = await Promise.all([
      getOutputStyleDirStyles(cwd),
      loadPluginOutputStyles(),
    ]);

    return {
      customStyles,
      pluginStyles,
      mergedStyles: [...pluginStyles, ...customStyles],
    };
  },
);

export function clearOutputStyleResourceCaches(): void {
  loadOutputStyleResources.cache?.clear?.();
  clearOutputStyleCaches();
}
