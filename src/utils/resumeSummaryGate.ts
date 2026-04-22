export const RESUME_SUMMARY_GATE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
export const RESUME_SUMMARY_GATE_LARGE_BYTES = 5 * 1024 * 1024;

type ResumeSummaryGateInput = {
  modified?: Date | number | null;
  fileSize?: number | null;
  summary?: string | null;
};

function toEpochMs(value: Date | number | null | undefined): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function shouldUseResumeSummaryGate(
  input: ResumeSummaryGateInput,
  nowMs = Date.now(),
): boolean {
  const modifiedMs = toEpochMs(input.modified);
  if (modifiedMs === null) return false;
  if (!Number.isFinite(nowMs) || nowMs < modifiedMs) return false;

  const stale = nowMs - modifiedMs >= RESUME_SUMMARY_GATE_STALE_MS;
  const large =
    typeof input.fileSize === 'number' &&
    Number.isFinite(input.fileSize) &&
    input.fileSize >= RESUME_SUMMARY_GATE_LARGE_BYTES;
  const hasSummary = typeof input.summary === 'string' && input.summary.trim().length > 0;

  return stale && large && hasSummary;
}
