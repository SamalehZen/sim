'use client'

import { memo, useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { parseStorySegments, type StorySegment } from '@/lib/stories/segments'
import { ChatChart } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-chart'

/**
 * HyperFix chat-light (Phase C) : prévisualisation d'une story — markdown +
 * blocs chart/table/grid/tabs. Les blocs chart réutilisent le rendu du chat.
 */
export const StoryPreview = memo(function StoryPreview({ code }: { code: string }) {
  const segments = useMemo(() => parseStorySegments(code), [code])
  return (
    <div className='flex flex-col gap-4'>
      {segments.map((segment, index) => (
        <StorySegmentView key={index} segment={segment} />
      ))}
    </div>
  )
})

function StorySegmentView({ segment }: { segment: StorySegment }) {
  if (segment.kind === 'markdown') {
    return (
      <div className='prose-sm max-w-none'>
        <Streamdown mode='static'>{segment.text}</Streamdown>
      </div>
    )
  }
  if (segment.kind === 'chart' || segment.kind === 'table') {
    // ChatChart rend les deux variantes (graphique + table avec vues).
    return <ChatChart content={JSON.stringify(segment.input)} />
  }
  if (segment.kind === 'grid') {
    const columns = segment.children.length
    const widths = segment.children.map((_, i) => segment.widths[i] ?? 1)
    const total = widths.reduce((a, b) => a + b, 0)
    return (
      <div
        className='grid gap-4'
        style={{ gridTemplateColumns: widths.map((w) => `${w / total}fr`).join(' ') }}
        data-columns={columns}
      >
        {segment.children.map((child, index) => (
          <div key={index} className='min-w-0'>
            <StorySegmentView segment={child} />
          </div>
        ))}
      </div>
    )
  }
  return <StoryTabs tabs={segment.tabs} />
}

function StoryTabs({ tabs }: { tabs: { title: string; children: StorySegment[] }[] }) {
  const [active, setActive] = useState(0)
  const current = tabs[Math.min(active, tabs.length - 1)]
  if (!current) return null
  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='flex gap-1 border-[var(--border)] border-b bg-[var(--surface-4)] px-2 pt-2'>
        {tabs.map((tab, index) => (
          <button
            key={index}
            type='button'
            onClick={() => setActive(index)}
            className={`rounded-t px-3 py-1.5 text-sm ${
              index === Math.min(active, tabs.length - 1)
                ? 'bg-[var(--surface-2)] font-medium'
                : 'text-[var(--text-tertiary)]'
            }`}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div className='flex flex-col gap-4 p-4'>
        {current.children.map((child, index) => (
          <StorySegmentView key={index} segment={child} />
        ))}
      </div>
    </div>
  )
}
