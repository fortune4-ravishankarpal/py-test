# Payload Soft Delete

`soft-delete` is a reusable [Payload CMS](https://payloadcms.com) plugin that blocks native
permanent deletion on selected collections and adds an audited, admin-friendly "Soft
delete" flow instead.

- `trash: false` — Payload's native trash feature is never involved.
- **Native delete is blocked** from the Admin UI, REST, GraphQL and the Local API via
  `access.delete: () => false` plus a `beforeDelete` hook guard. No permanent deletion
  is possible through normal admin or API operations—even with `overrideAccess`.

## Install and configure

```ts
import { buildConfig } from 'payload'
import { softDelete } from '@payload-pln/soft-delete'

export default buildConfig({
  collections: [Posts, Users],
  plugins: [
    softDelete({
      collections: {
        users: true,
        posts: true,
      },
    }),
  ],
})
```

## What the plugin does

For every collection listed in `collections`, the plugin:

1. Sets `trash: false` and `access.delete: () => false`, so native Payload delete is
   impossible (Admin UI button is gone, REST/GraphQL/Local API throw 403).
2. Adds three audit fields:

| Field            | Type     | Purpose                                        |
| ---------------- | -------- | ---------------------------------------------- |
| `isSoftDeleted`  | checkbox | `true` once the document has been soft-deleted |
| `softDeletedAt`  | date     | When it was soft-deleted                       |
| `softDeletedBy`  | text     | ID of the user who soft-deleted it (`req.user`) |

   All three are hidden from the admin edit screen and are only ever set through the
   plugin's soft-delete path.
3. Adds a **Soft delete** column to the admin list view. Each row's button calls the
   collection endpoint and then refreshes the list.
4. Adds a collection endpoint `POST /api/<collection>/:id/soft-delete` that performs a
   plain `payload.update()`:

```
Payload Delete         →  BLOCKED (403)
Admin List View        →  Soft delete button
                          →  POST /:id/soft-delete
                          →  payload.update()
                          →  isSoftDeleted = true
                              softDeletedAt = now
                              softDeletedBy = current user
```

The soft-delete update touches **only** the three audit fields; documents are never
removed from the database.

A `beforeChange` hook keeps the audit fields consistent no matter which API path flips
`isSoftDeleted` to `true` (the endpoint, a REST PATCH, or the Local API).

## API

```ts
// Soft delete a single document (requires update access on the collection)
await fetch('/api/posts/66f1.../soft-delete', { method: 'POST' })

// Local API equivalent
await payload.update({
  collection: 'posts',
  id: postId,
  data: {
    isSoftDeleted: true,
    softDeletedAt: new Date().toISOString(),
    softDeletedBy: req.user?.id ? String(req.user.id) : null,
  },
})

// Native delete is blocked everywhere
await payload.delete({ collection: 'posts', id: postId, overrideAccess: false }) // throws

// Soft-deleted documents stay fully readable — this plugin deliberately does not add
// read filtering, restore, GDPR or trash views yet.
```

## Tests

- `pnpm test:int` verifies the default field values, the audited soft-delete update,
  the blocked native delete (Local API), the REST endpoint and the blocked REST delete.
- `pnpm test:e2e` drives the admin UI: clicking **Soft delete** in the list view marks
  the row, and the native Delete action is unavailable.