'use client'
import type { DefaultCellComponentProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation.js'
import { useState } from 'react'

type SoftDeleteRowData = {
  id: number | string
  isSoftDeleted?: boolean
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '12px',
  cursor: 'pointer',
}

/**
 * Renders the per-row "Soft delete" action inside the admin list view.
 * Clicking calls the collection endpoint `POST /api/<collection>/:id/soft-delete`
 * which performs a regular `payload.update()` on the soft-delete fields.
 */
export const SoftDeleteCell: React.FC<DefaultCellComponentProps> = ({ collectionSlug, rowData }) => {
  const { config } = useConfig()
  const router = useRouter()
  const doc = rowData as SoftDeleteRowData
  const [deleting, setDeleting] = useState(false)

  if (doc.isSoftDeleted) {
    return (
      <button type="button" disabled style={buttonStyle}>
        Soft deleted
      </button>
    )
  }

  const softDelete = async () => {
    if (deleting) return
    setDeleting(true)

    try {
      const response = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: `/${collectionSlug}/${String(doc.id)}/soft-delete`,
        }),
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        const body = await response.json()
        throw new Error(body?.errors?.[0]?.message ?? `Soft delete failed (${response.status})`)
      }

      // Re-fetch the list so the row reflects its new soft-deleted state.
      router.refresh()
    } catch (error) {
      console.error('Soft delete failed:', error) // eslint-disable-line no-console
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      type="button"
      style={buttonStyle}
      disabled={deleting}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void softDelete()
      }}
    >
      {deleting ? 'Soft deleting…' : 'Soft delete'}
    </button>
  )
}