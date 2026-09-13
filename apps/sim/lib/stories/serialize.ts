/**
 * HyperFix chat-light (Phase C) : sérialisation segments → code story
 * (inverse de `parseStorySegments`, pour l'éditeur par blocs).
 */
import type { StorySegment } from '@/lib/stories/segments'

/** Reconstruit le code depuis des segments édités. */
export function serializeStorySegments(segments: StorySegment[]): string {
  return segments.map(serializeSegment).join('')
}

function serializeSegment(segment: StorySegment): string {
  switch (segment.kind) {
    case 'markdown':
      return segment.text
    case 'chart':
      return `<chart>${JSON.stringify(segment.input)}</chart>`
    case 'table':
      return `<table>${JSON.stringify(segment.input)}</table>`
    case 'grid': {
      const widths =
        segment.widths.length === segment.children.length
          ? ` widths="${segment.widths.join(',')}"`
          : ''
      return `<grid${widths}>${segment.children.map(serializeSegment).join('')}</grid>`
    }
    case 'tabs':
      return segment.tabs
        .map(
          (tab) =>
            `<tab title="${escapeAttr(tab.title)}">${tab.children.map(serializeSegment).join('')}</tab>`
        )
        .join('')
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
