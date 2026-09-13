'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { Input as ChartInput } from '@/lib/charts/nao/display-chart'
import * as displayChart from '@/lib/charts/nao/display-chart'
import { parseStorySegments, type StorySegment } from '@/lib/stories/segments'
import { serializeStorySegments } from '@/lib/stories/serialize'
import { validateStoryCode } from '@/lib/stories/story-code'
import {
  ChartConfigEditDialog,
  type EditableChartInput,
} from '../message-content/components/chart-display/chart-edit-dialog'

interface BlockItem {
  id: string
  segment: StorySegment
}

let blockCounter = 0
function nextBlockId(): string {
  blockCounter += 1
  return `block-${Date.now().toString(36)}-${blockCounter}`
}

function toItems(segments: StorySegment[]): BlockItem[] {
  return segments.map((segment) => ({ id: nextBlockId(), segment }))
}

/**
 * HyperFix chat-light (Phase C) : éditeur par blocs (drag top-level,
 * édition inline/dialoque, ajout/suppression). Sauvegarde = replace.
 */
export const StoryBlocksEditor = memo(function StoryBlocksEditor({
  code,
  onSave,
}: {
  code: string
  onSave: (code: string) => Promise<void>
}) {
  const [items, setItems] = useState<BlockItem[]>(() => toItems(parseStorySegments(code)))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setItems(toItems(parseStorySegments(code)))
  }, [code])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id)
      const newIndex = prev.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const patchItem = (id: string, segment: StorySegment) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, segment } : item)))
  }

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  const moveItem = (id: string, direction: -1 | 1) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      return arrayMove(prev, index, target)
    })
  }

  const addItem = (segment: StorySegment) => {
    setItems((prev) => [...prev, { id: nextBlockId(), segment }])
  }

  const draftCode = useMemo(
    () => serializeStorySegments(items.map((item) => item.segment)),
    [items]
  )
  const validation = validateStoryCode(draftCode)

  const handleSave = async () => {
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    if (draftCode === code) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draftCode)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item, index) => (
            <SortableBlock
              key={item.id}
              item={item}
              onChange={(segment) => patchItem(item.id, segment)}
              onRemove={() => removeItem(item.id)}
              onMoveUp={index > 0 ? () => moveItem(item.id, -1) : undefined}
              onMoveDown={index < items.length - 1 ? () => moveItem(item.id, 1) : undefined}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div className='flex flex-wrap gap-2'>
        <AddButton
          label='+ Texte'
          onClick={() => addItem({ kind: 'markdown', text: 'Nouveau texte' })}
        />
        <AddButton label='+ Graphique' onClick={() => addItem(emptyChartBlock())} />
        <AddButton label='+ Table' onClick={() => addItem(emptyTableBlock())} />
      </div>

      {!validation.ok && (
        <p className='text-[var(--text-error)] text-xs' role='alert'>
          {validation.error}
        </p>
      )}
      {error && (
        <p className='text-[var(--text-error)] text-xs' role='alert'>
          {error}
        </p>
      )}
      <div className='flex justify-end'>
        <Button
          variant='primary'
          size='sm'
          className='rounded-full'
          disabled={saving || !validation.ok || draftCode === code}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save new version'}
        </Button>
      </div>
    </div>
  )
})

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant='outline' size='sm' className='rounded-full text-xs' onClick={onClick}>
      <Plus className='size-3' /> {label}
    </Button>
  )
}

function emptyChartBlock(): StorySegment {
  return {
    kind: 'chart',
    input: {
      source: { type: 'static', rows: [] },
      chart_type: 'bar',
      x_axis_key: '',
      x_axis_type: 'category',
      series: [{ data_key: '' }],
      title: 'Nouveau graphique',
    } as ChartInput,
  }
}

function emptyTableBlock(): StorySegment {
  return {
    kind: 'table',
    input: {
      source: { type: 'static', rows: [] },
      chart_type: 'table',
      title: 'Nouveau tableau',
    } as ChartInput,
  }
}

function SortableBlock({
  item,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: BlockItem
  onChange: (segment: StorySegment) => void
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface-2)] ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className='flex items-center gap-1 border-[var(--border)] border-b px-2 py-1'>
        <button
          type='button'
          {...attributes}
          {...listeners}
          className='cursor-grab px-1 text-[var(--text-tertiary)]'
          aria-label='Drag to reorder'
        >
          ⠿
        </button>
        <span className='flex-1 text-[var(--text-tertiary)] text-xs'>
          {blockLabel(item.segment)}
        </span>
        {onMoveUp && <MiniButton label='↑' title='Move up' onClick={onMoveUp} />}
        {onMoveDown && <MiniButton label='↓' title='Move down' onClick={onMoveDown} />}
        <MiniButton label='✕' title='Delete block' onClick={onRemove} />
      </div>
      <div className='p-2'>
        <SegmentEditor segment={item.segment} onChange={onChange} />
      </div>
    </div>
  )
}

function MiniButton({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      onClick={onClick}
      className='rounded px-1.5 py-0.5 text-[var(--text-tertiary)] text-xs hover-hover:bg-[var(--surface-4)]'
    >
      {label}
    </button>
  )
}

function blockLabel(segment: StorySegment): string {
  switch (segment.kind) {
    case 'markdown':
      return 'Texte'
    case 'chart':
      return `Graphique · ${segment.input.title ?? segment.input.chart_type}`
    case 'table':
      return `Table · ${segment.input.title ?? 'table'}`
    case 'grid':
      return `Grille (${segment.children.length} blocs)`
    case 'tabs':
      return `Onglets (${segment.tabs.length})`
  }
}

function SegmentEditor({
  segment,
  onChange,
}: {
  segment: StorySegment
  onChange: (segment: StorySegment) => void
}) {
  if (segment.kind === 'markdown') {
    return (
      <textarea
        value={segment.text}
        onChange={(e) => onChange({ kind: 'markdown', text: e.target.value })}
        rows={3}
        className='w-full resize-y rounded border border-[var(--border)] bg-transparent p-2 text-sm'
        aria-label='Markdown text'
      />
    )
  }
  if (segment.kind === 'chart' || segment.kind === 'table') {
    return (
      <ChartBlockEditor
        input={segment.input}
        kind={segment.kind}
        onChange={(input) => onChange({ kind: segment.kind, input } as StorySegment)}
      />
    )
  }
  if (segment.kind === 'grid') {
    return (
      <div className='flex flex-col gap-2'>
        <label className='flex items-center gap-2 text-xs'>
          Largeurs
          <input
            value={segment.widths.join(',')}
            onChange={(e) => {
              const widths = e.target.value
                .split(',')
                .map((w) => Number.parseInt(w.trim(), 10))
                .filter((w) => Number.isFinite(w) && w > 0)
              onChange({ ...segment, widths })
            }}
            placeholder='2,1'
            className='w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-xs'
            aria-label='Column widths'
          />
        </label>
        {segment.children.map((child, index) => (
          <div key={index} className='rounded border border-dashed border-[var(--border)] p-1'>
            <SegmentEditor
              segment={child}
              onChange={(next) => {
                const children = segment.children.slice()
                children[index] = next
                onChange({ ...segment, children })
              }}
            />
            <div className='flex justify-end gap-1 pt-1'>
              <MiniButton
                label='↑'
                title='Move up'
                onClick={() => moveChild(segment, index, -1, onChange)}
              />
              <MiniButton
                label='↓'
                title='Move down'
                onClick={() => moveChild(segment, index, 1, onChange)}
              />
              <MiniButton
                label='✕'
                title='Delete'
                onClick={() =>
                  onChange({ ...segment, children: segment.children.filter((_, i) => i !== index) })
                }
              />
            </div>
          </div>
        ))}
        <ChildAddButtons
          onAdd={(child) => onChange({ ...segment, children: [...segment.children, child] })}
        />
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-2'>
      {segment.tabs.map((tab, tabIndex) => (
        <div key={tabIndex} className='rounded border border-[var(--border)] p-2'>
          <input
            value={tab.title}
            onChange={(e) => {
              const tabs = segment.tabs.slice()
              tabs[tabIndex] = { ...tab, title: e.target.value }
              onChange({ ...segment, tabs })
            }}
            className='mb-2 w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm font-medium'
            aria-label='Tab title'
          />
          {tab.children.map((child, childIndex) => (
            <div
              key={childIndex}
              className='mb-1 rounded border border-dashed border-[var(--border)] p-1'
            >
              <SegmentEditor
                segment={child}
                onChange={(next) => {
                  const tabs = segment.tabs.slice()
                  const children = tabs[tabIndex].children.slice()
                  children[childIndex] = next
                  tabs[tabIndex] = { ...tabs[tabIndex], children }
                  onChange({ ...segment, tabs })
                }}
              />
              <div className='flex justify-end gap-1 pt-1'>
                <MiniButton
                  label='✕'
                  title='Delete'
                  onClick={() => {
                    const tabs = segment.tabs.slice()
                    tabs[tabIndex] = {
                      ...tabs[tabIndex],
                      children: tabs[tabIndex].children.filter((_, i) => i !== childIndex),
                    }
                    onChange({ ...segment, tabs })
                  }}
                />
              </div>
            </div>
          ))}
          <ChildAddButtons
            onAdd={(child) => {
              const tabs = segment.tabs.slice()
              tabs[tabIndex] = { ...tabs[tabIndex], children: [...tabs[tabIndex].children, child] }
              onChange({ ...segment, tabs })
            }}
          />
        </div>
      ))}
      <AddButton
        label='+ Onglet'
        onClick={() =>
          onChange({
            ...segment,
            tabs: [...segment.tabs, { title: 'Nouvel onglet', children: [] }],
          })
        }
      />
    </div>
  )
}

function moveChild(
  segment: Extract<StorySegment, { kind: 'grid' }>,
  index: number,
  direction: -1 | 1,
  onChange: (segment: StorySegment) => void
) {
  const target = index + direction
  if (target < 0 || target >= segment.children.length) return
  const children = segment.children.slice()
  const [moved] = children.splice(index, 1)
  children.splice(target, 0, moved)
  onChange({ ...segment, children })
}

function ChildAddButtons({ onAdd }: { onAdd: (child: StorySegment) => void }) {
  return (
    <div className='flex flex-wrap gap-1'>
      <MiniButton
        label='+ Texte'
        title='Add text'
        onClick={() => onAdd({ kind: 'markdown', text: 'Nouveau texte' })}
      />
      <MiniButton label='+ Graphique' title='Add chart' onClick={() => onAdd(emptyChartBlock())} />
      <MiniButton label='+ Table' title='Add table' onClick={() => onAdd(emptyTableBlock())} />
    </div>
  )
}

function ChartBlockEditor({
  input,
  kind,
  onChange,
}: {
  input: ChartInput
  kind: 'chart' | 'table'
  onChange: (input: ChartInput) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const columns = useMemo(() => {
    if (input.source.type !== 'static' || !input.source.rows || input.source.rows.length === 0) {
      return [] as string[]
    }
    return Object.keys(input.source.rows[0] ?? {})
  }, [input])
  const rows = useMemo(() => {
    if (input.source.type !== 'static' || !input.source.rows) return [] as Record<string, unknown>[]
    return input.source.rows as Record<string, unknown>[]
  }, [input])

  if (kind === 'table') {
    return (
      <div className='text-sm text-[var(--text-secondary)]'>
        Table · {input.title ?? 'sans titre'} ({rows.length} lignes)
      </div>
    )
  }

  const isBuiltin = displayChart.isBuiltinChartType(input.chart_type)
  if (!isBuiltin) {
    return (
      <div className='text-sm text-[var(--text-secondary)]'>
        Custom chart “{input.chart_type}” — ask Luna to change it.
      </div>
    )
  }

  const handleSave = async (next: EditableChartInput) => {
    setSaving(true)
    try {
      onChange({ ...next, source: input.source } as ChartInput)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex items-center justify-between gap-2'>
      <span className='truncate text-sm'>
        {input.title ?? input.chart_type} · {input.chart_type}
      </span>
      <Button
        variant='outline'
        size='sm'
        className='rounded-full text-xs'
        onClick={() => setDialogOpen(true)}
      >
        Éditer
      </Button>
      <ChartConfigEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={{ ...input, chart_type: input.chart_type } as EditableChartInput}
        availableColumns={columns}
        data={rows}
        onSave={handleSave}
        isSaving={saving}
        description='Tweak the chart parameters.'
      />
    </div>
  )
}
