'use client'

import React, { useState } from 'react'
import { ConfirmationModal, useConfig, useDocumentInfo, useModal, toast, Button, } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useRouter } from 'next/navigation.js'

export const SoftDeleteButton: React.FC = () => {
  const { config } = useConfig()
  const { collectionSlug, id } = useDocumentInfo()
  const { openModal, closeModal } = useModal()
  const router = useRouter()

  const [deleting, setDeleting] = useState(false)

  // Don't show button on new/unsaved documents
  if (!id || !collectionSlug) return null

  const modalSlug = `soft-delete-edit-confirm-${String(id)}`

  const handleSoftDelete = async () => {
    if (deleting) return
    setDeleting(true)

    try {
      const response = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: `/${collectionSlug}/${String(id)}/soft-delete`,
        }),
        {
          method: 'POST',
          credentials: 'include',
        },
      )

      if (!response.ok) {
        let message = `delete failed (${response.status})`
        try {
          const body = await response.json()
          message = body?.errors?.[0]?.message ?? message
        } catch { }
        throw new Error(message)
      }

      closeModal(modalSlug)
      toast.success('Record soft deleted successfully.')

      // Redirect user back to collection list after soft deleting
      router.push(`/admin/collections/${collectionSlug}`)
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
      <Button
        buttonStyle='none'
        margin={false}
        className='text-start'
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openModal(modalSlug)
        }}
        disabled={deleting}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </Button>
      <ConfirmationModal
        modalSlug={modalSlug}
        heading="Delete record"
        body="Are you sure you want to delete this record?"
        onConfirm={() => {
          void handleSoftDelete()
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