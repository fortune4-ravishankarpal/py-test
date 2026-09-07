'use client'

import type { DefaultCellComponentProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { ConfirmationModal, useConfig, useModal, toast } from '@payloadcms/ui'
import { useRouter } from 'next/navigation.js'
import { useState } from 'react'

type SoftDeleteRowData = {
  id: number | string
  isSoftDeleted?: boolean
}

const buttonStyle: React.CSSProperties = {
  // padding: '4px 8px',
  // fontSize: '12px',
  cursor: 'pointer',
}

export const SoftDeleteCell: React.FC<DefaultCellComponentProps> = ({
  collectionSlug,
  rowData,
}) => {
  const { config } = useConfig()
  const { openModal, closeModal } = useModal()
  const router = useRouter()
  const doc = rowData as SoftDeleteRowData

  const [deleting, setDeleting] = useState(false)
  const modalSlug = `soft-delete-confirm-${String(doc.id)}`

  if (doc.isSoftDeleted) {
    return (
      <button type="button" disabled style={buttonStyle}>
        Deleted
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
          credentials: 'include',
        },
      )

      if (!response.ok) {
        let message = `Delete failed (${response.status})`

        try {
          const body = await response.json()
          message = body?.errors?.[0]?.message ?? message
        } catch { }

        throw new Error(message)
      }

      closeModal(modalSlug)

      toast.success('Record deleted successfully.')

      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to delete the record.',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        style={buttonStyle}
        disabled={deleting}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openModal(modalSlug)
        }}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </button>

      <ConfirmationModal
        modalSlug={modalSlug}
        heading="Delete record"
        body="Are you sure you want to delete this record?"
        onConfirm={() => {
          void softDelete()
        }}
        onCancel={() => {
          if (!deleting) {
            closeModal(modalSlug)
          }
        }}
      />
    </>
  )
}