/**
 * HyperFix chat-light (Phase B2) : résolution insensible à la casse des noms
 * de colonnes, portée depuis nao (`apps/shared/src/map.ts`).
 */

export function resolveColumnName(columns: string[], key: string): string {
  if (columns.includes(key)) {
    return key
  }
  const lower = key.toLowerCase()
  const match = columns.find((column) => column.toLowerCase() === lower)
  return match ?? key
}

export function resolveDataKey(data: Record<string, unknown>[], key: string | undefined): string {
  if (key === undefined) {
    return ''
  }
  const row = data[0]
  if (!row) {
    return key
  }
  return resolveColumnName(Object.keys(row), key)
}
