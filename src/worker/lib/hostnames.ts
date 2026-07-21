export function normalizeHostnames(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase().replace(/\.$/, "")))].sort();
}

export function sameHostnames(left: string[], right: string[]) {
  return JSON.stringify(normalizeHostnames(left)) === JSON.stringify(normalizeHostnames(right));
}
