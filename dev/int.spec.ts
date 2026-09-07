import { createPayloadRequest, getPayload, handleEndpoints, type Payload } from 'payload'
import config from '@payload-config'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload?.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const createPost = (title: string) =>
  payload.create({ collection: 'posts', data: { title }, overrideAccess: true })

const findUser = async (email: string) => {
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  return docs[0]
}

describe('softDelete', () => {
  test('adds soft-delete fields with safe defaults', async () => {
    const post = await createPost('Default fields')
    expect(post.isSoftDeleted).toBe(false)
    expect(post.softDeletedAt)?.toBeUndefined()
    expect(post.softDeletedBy)?.toBeUndefined()
  })

  test('soft deletes a document via update and records who did it', async () => {
    const post = await createPost('Soft delete with user')
    const devUser = await findUser('dev@payloadcms.com')
    expect(devUser).toBeDefined()

    const req = await createPayloadRequest({
      config,
      request: new Request('http://localhost:3000/api/posts', { method: 'PATCH' }),
    })
    // @ts-expect-error: `req.user` representation in tests
    req.user = { ...devUser, collection: 'users' }

    const updated = await payload.update({
      collection: 'posts',
      id: post.id,
      req,
      overrideAccess: false,
      data: { isSoftDeleted: true },
    })

    expect(updated.isSoftDeleted).toBe(true)
    expect(updated.softDeletedAt).toBeDefined()
    expect(updated.softDeletedBy).toBe(String(devUser.id))
  })

  test('blocks native delete from the Local API and never removes the document', async () => {
    const post = await createPost('Native delete blocked')

    await expect(payload.delete({ collection: 'posts', id: post.id, overrideAccess: false })).rejects.toThrow()
    // Even an explicit `overrideAccess` cannot bypass the plugin's beforeDelete guard.
    await expect(payload.delete({ collection: 'posts', id: post.id, overrideAccess: true })).rejects.toThrow()

    const found = await payload.findByID({ collection: 'posts', id: post.id, overrideAccess: true })
    expect(found.title).toBe('Native delete blocked')
  })

  test('soft-deletes through POST /api/posts/:id/soft-delete', async () => {
    const post = await createPost('Endpoint soft delete')

    const loginResponse = await handleEndpoints({
      config,
      request: new Request('http://localhost:3000/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@payloadcms.com', password: 'test' }),
      }),
    })
    expect(loginResponse.status).toBe(200)
    const login = await loginResponse.json()

    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api/posts/${post.id}/soft-delete`, {
        method: 'POST',
        headers: { Authorization: `JWT ${login.token}` },
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.message).toBe('Soft deleted successfully.')
    expect(body.doc.isSoftDeleted).toBe(true)
    expect(body.doc.softDeletedAt).toBeDefined()
    expect(body.doc.softDeletedBy).toBe(String(login.user.id))

    const found = await payload.findByID({ collection: 'posts', id: post.id, overrideAccess: true })
    expect(found.isSoftDeleted).toBe(true)
  })

  test('blocks native DELETE via the REST API', async () => {
    const post = await createPost('REST delete blocked')

    const loginResponse = await handleEndpoints({
      config,
      request: new Request('http://localhost:3000/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@payloadcms.com', password: 'test' }),
      }),
    })
    const login = await loginResponse.json()

    const response = await handleEndpoints({
      config,
      request: new Request(`http://localhost:3000/api/posts/${post.id}`, {
        method: 'DELETE',
        headers: { Authorization: `JWT ${login.token}` },
      }),
    })

    expect(response.status).toBe(403)

    const found = await payload.findByID({ collection: 'posts', id: post.id, overrideAccess: true })
    expect(found.title).toBe('REST delete blocked')
  })
})