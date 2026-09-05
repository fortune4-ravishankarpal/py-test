# Payload Soft Delete

`soft-delete` enables audited soft deletion for selected Payload CMS collections. It uses Payload 3's built-in `trash` support, so deleting a document records a timestamp instead of removing the database record. Normal reads automatically exclude deleted documents.

## Install and configure

```ts
import { buildConfig } from 'payload'
import { softDelete } from 'soft-delete'

export default buildConfig({
  collections: [Posts, Products],
  plugins: [
    softDelete({
      collections: {
        posts: true,
        products: true,
      },
    }),
  ],
})
```

## Fields added to each selected collection

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `isSoftDeleted` | checkbox | `false` | Indicates that the record is in trash. |
| `softDeletedBy` | text | optional / `null` after restore | ID of the authenticated user who trashed it, if available. |
| `softDeletedAt` | date | optional / `null` after restore | Date/time it was trashed. |
| `deletedAt` | date | `null` | Payload's native trash timestamp. |

`softDeletedAt` is set from `deletedAt`; this guarantees it represents the actual delete date/time. The plugin uses the conventional `softDeleted*` spelling for the requested delete audit fields.

## How deletion and reads work

The plugin enables `trash: true` on selected collections. Payload handles the delete/read lifecycle atomically:

- A trash action updates `deletedAt` rather than removing the document.
- The plugin's `beforeChange` hook sets `isSoftDeleted`, `softDeletedAt`, and `softDeletedBy` in that same update.
- Payload's read operation filters trashed documents before the `beforeRead` hook runs. The plugin preserves existing `beforeRead` hooks and keeps the audit flag consistent for legacy trashed data.
- Restoring a document (`deletedAt: null`) clears all three audit fields.

To include trashed documents in a local API query, pass `trash: true`:

```ts
const result = await payload.find({
  collection: 'posts',
  trash: true,
  where: { isSoftDeleted: { equals: true } },
})
```

## Manual development check

Run `pnpm dev`, open the Posts collection in the Payload admin UI, create a post, and use **Trash**. It disappears from the normal list. Open the Trash view to confirm `isSoftDeleted` is true and the date fields are populated; then restore it and confirm the fields are cleared.

For a local API equivalent, use:

```ts
await payload.update({
  collection: 'posts',
  id: post.id,
  data: { deletedAt: new Date().toISOString() },
})

await payload.find({ collection: 'posts' }) // does not return `post`
await payload.find({ collection: 'posts', trash: true }) // includes `post`
```

## Tests

`pnpm test:int` verifies defaults, the soft-delete update, default read filtering, visibility through `trash: true`, and restore behavior.
