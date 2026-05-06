function formatIssues(issues) {
  return {
    flatten() {
      const fieldErrors = {}
      const formErrors = []

      for (const issue of issues) {
        if (issue.path.length > 0) {
          const field = issue.path[0]
          const key = String(field)
          fieldErrors[key] ||= []
          fieldErrors[key].push(issue.message)
        } else {
          formErrors.push(issue.message)
        }
      }

      return { fieldErrors, formErrors }
    },
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const McpbManifestSchema = {
  safeParse(value) {
    const issues = []

    if (!isRecord(value)) {
      issues.push({ path: [], message: 'Manifest must be an object' })
    } else {
      if (typeof value.name !== 'string' || value.name.trim() === '') {
        issues.push({ path: ['name'], message: 'Name is required' })
      }

      if (value.version !== undefined && typeof value.version !== 'string') {
        issues.push({ path: ['version'], message: 'Version must be a string' })
      }

      if (!isRecord(value.author)) {
        issues.push({ path: ['author'], message: 'Author is required' })
      } else if (
        typeof value.author.name !== 'string' ||
        value.author.name.trim() === ''
      ) {
        issues.push({ path: ['author', 'name'], message: 'Author name is required' })
      }

      if (
        value.user_config !== undefined &&
        !isRecord(value.user_config)
      ) {
        issues.push({
          path: ['user_config'],
          message: 'user_config must be an object',
        })
      }
    }

    if (issues.length > 0) {
      return {
        success: false,
        error: formatIssues(issues),
      }
    }

    return {
      success: true,
      data: value,
    }
  },
}

export async function getMcpConfigForManifest(_manifest) {
  return null
}
