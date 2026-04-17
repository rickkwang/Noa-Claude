export type ModelOption = {
  value: string;
  label: string;
  description: string;
};

export function mergeModelOptions(
  current: ModelOption[],
  discovered: ModelOption[],
): ModelOption[] {
  if (discovered.length === 0) return current;

  const existing = new Set(current.map(option => option.value));
  const merged = [...current];
  for (const option of discovered) {
    if (!existing.has(option.value)) {
      merged.push(option);
      existing.add(option.value);
    }
  }
  return merged;
}
