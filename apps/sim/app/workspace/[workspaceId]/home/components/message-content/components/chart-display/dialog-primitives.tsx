'use client'

import type * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'

/**
 * HyperFix chat-light (Phase B2) : adaptateurs de dialogue (API nao `ui/dialog`
 * sur Radix, habillage sim). Évite de réécrire le dialogue d'édition porté.
 */
export function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/50' />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-6',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label='Close'
          className='absolute top-4 right-4 rounded p-1 text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-4)]'
        >
          <X className='size-4' />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-semibold text-[var(--text-primary)] text-base', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-[var(--text-secondary)] text-sm', className)}
      {...props}
    />
  )
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />
}
