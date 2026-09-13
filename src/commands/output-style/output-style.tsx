import * as React from 'react'
import { Pane } from '../../components/design-system/Pane.js'
import { OutputStylePicker } from '../../components/OutputStylePicker.js'
import { DEFAULT_OUTPUT_STYLE_NAME } from '../../constants/outputStyles.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { OutputStyle } from '../../utils/config.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

/**
 * Direct entry to the picker that until now was only reachable through
 * /config → Output style. Writes the same key to the same source as
 * Config.tsx does, so both entry points stay interchangeable: the style is
 * read back by getOutputStyleConfig(), and the system prompt section is keyed
 * on the style name (`output_style:<name>`), so the next turn picks it up
 * without a cache sweep.
 */
export const call: LocalJSXCommandCall = async (onDone, _context) => {
  const currentStyle = (getSettings_DEPRECATED()?.outputStyle ??
    DEFAULT_OUTPUT_STYLE_NAME) as OutputStyle

  const handleComplete = (style: OutputStyle | undefined) => {
    updateSettingsForSource('localSettings', { outputStyle: style })
    onDone(`Output style set to ${style ?? DEFAULT_OUTPUT_STYLE_NAME}`)
  }

  const handleCancel = () => {
    onDone('Output style picker dismissed', { display: 'system' })
  }

  return (
    <Pane color="permission">
      <OutputStylePicker
        initialStyle={currentStyle}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </Pane>
  )
}
