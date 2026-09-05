import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload?.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('softDelete', () => {
  test('adds soft-delete fields with safe defaults', async () => {
    const post = await payload.create({ collection: 'posts', data: { title: 'Default fields' } })
    expect(post.isSoftDeleted).toBe(false)
    expect(post.softDeletedAt).toBeUndefined()
    expect(post.softDeletedBy).toBeUndefined()
  })

  test('marks a trashed record and excludes it from normal reads', async () => {
    const post = await payload.create({ collection: 'posts', data: { title: 'Trash me' } })
    const deletedAt = new Date().toISOString()
    const trashed = await payload.update({ collection: 'posts', id: post.id, data: { deletedAt } })
    expect(trashed.isSoftDeleted).toBe(true)
    expect(trashed.softDeletedAt).toBe(deletedAt)

    const normalRead = await payload.find({ collection: 'posts', where: { id: { equals: post.id } } })
    expect(normalRead.docs).toHaveLength(0)
    const trashRead = await payload.find({ collection: 'posts', trash: true, where: { id: { equals: post.id } } })
    expect(trashRead.docs).toHaveLength(1)
  })

  test('clears audit fields when a record is restored', async () => {
    const post = await payload.create({ collection: 'posts', data: { title: 'Restore me' } })
    await payload.update({ collection: 'posts', id: post.id, data: { deletedAt: new Date().toISOString() } })
    const restored = await payload.update({ collection: 'posts', id: post.id, trash: true, data: { deletedAt: null } })
    expect(restored.isSoftDeleted).toBe(false)
    expect(restored.softDeletedAt).toBeNull()
    expect(restored.softDeletedBy).toBeNull()
  })
})
