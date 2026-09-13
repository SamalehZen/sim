/**
 * HyperFix chat-light (Phase B2) : pagination de tableau, portée depuis nao
 * (`apps/frontend/src/components/ui/table-pagination.tsx`).
 * ADAPTATIONS : boutons `@sim/emcn`, select natif, premières/dernières pages
 * en glyphes texte (pas d'icônes doubles en bibliothèque).
 */
import { Button } from '@sim/emcn'
import { ChevronLeft, ChevronRight } from '@sim/emcn/icons'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

interface TablePaginationProps {
  totalRows: number
  pageIndex: number
  pageSize: number
  pageCount: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function TablePagination({
  totalRows,
  pageIndex,
  pageSize,
  pageCount,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const canPrevious = pageIndex > 0
  const canNext = pageIndex < pageCount - 1

  return (
    <div className='shrink-0 border-[var(--border)] border-t px-4 py-2'>
      <div className='flex shrink-0 items-center justify-between'>
        <span className='text-[var(--text-muted)] text-sm'>{totalRows} rows</span>

        <div className='flex flex-wrap items-center justify-end gap-2'>
          <div className='flex items-center gap-2'>
            <span className='text-[var(--text-muted)] text-sm'>Rows per page</span>
            <select
              value={`${pageSize}`}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className='rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-sm'
              aria-label='Rows per page'
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={`${size}`}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <span className='text-[var(--text-muted)] text-sm'>
            Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
          </span>

          <div className='flex items-center gap-1'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={() => onPageChange(0)}
              disabled={!canPrevious}
              aria-label='Go to first page'
            >
              <span aria-hidden='true'>«</span>
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={() => onPageChange(pageIndex - 1)}
              disabled={!canPrevious}
              aria-label='Go to previous page'
            >
              <ChevronLeft />
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={() => onPageChange(pageIndex + 1)}
              disabled={!canNext}
              aria-label='Go to next page'
            >
              <ChevronRight />
            </Button>
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={() => onPageChange(pageCount - 1)}
              disabled={!canNext}
              aria-label='Go to last page'
            >
              <span aria-hidden='true'>»</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
