export type PointSelectionResolveResult = {
  pointIds: string[];
  missingIds: string[];
  error?: string;
};

export function resolvePointSelectionInput(input: string, availablePointIds: string[]): PointSelectionResolveResult {
  const normalized = input.trim().replace(/\s*-\s*/g, "-");
  if (!normalized) {
    return { pointIds: [], missingIds: [], error: "请输入点号，例如 53,54,55 或 59-66。" };
  }

  const available = new Set(availablePointIds);
  const tokens = normalized.split(/[\s,，;；]+/).map((token) => token.trim()).filter(Boolean);
  const pointIds: string[] = [];
  const missingIds: string[] = [];

  for (const token of tokens) {
    const range = parseRangeToken(token);
    if (range.error) {
      return { pointIds: [], missingIds: [], error: range.error };
    }

    const ids = range.ids.length ? range.ids : [token];
    for (const id of ids) {
      if (available.has(id)) {
        pointIds.push(id);
      } else {
        missingIds.push(id);
      }
    }
  }

  return {
    pointIds: uniqueInOrder(pointIds),
    missingIds: uniqueInOrder(missingIds)
  };
}

function parseRangeToken(token: string): { ids: string[]; error?: string } {
  if (!token.includes("-")) return { ids: [] };

  const match = token.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return { ids: [], error: `点号范围 ${token} 格式不正确，请使用 53-66 这种数字范围。` };
  }

  const startText = match[1];
  const endText = match[2];
  const start = Number(startText);
  const end = Number(endText);
  const step = start <= end ? 1 : -1;
  const width = Math.max(startText.length, endText.length);
  const ids: string[] = [];

  for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
    ids.push(String(value).padStart(width, "0"));
  }

  return { ids };
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
