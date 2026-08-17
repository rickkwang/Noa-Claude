// @ts-nocheck
/**
 * Error IDs for tracking error sources in production.
 * These IDs are obfuscated identifiers that help us trace
 * which logError() call generated an error.
 *
 * These errors are represented as individual const exports for optimal
 * dead code elimination (external build will only see the numbers).
 *
 * ADDING A NEW ERROR TYPE:
 * 1. Add a const based on Next ID.
 * 2. Increment Next ID.
 * Next ID: 349
 */

export const E_TOOL_USE_SUMMARY_GENERATION_FAILED = 344
export const E_ASSISTANT_INVALID_ARGUMENT = 347
export const E_ASSISTANT_SETTINGS_WRITE_FAILED = 348
