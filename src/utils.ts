export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export function matchKeywords(text: string | null, keywords: string[]): boolean {
  if (!text || !keywords.length) {
    return false
  }
  const normalizedText = text.toLowerCase().trim()
  return keywords
    .map(keyword => keyword.toLowerCase().trim())
    .some(keyword => normalizedText.includes(keyword))
}
