import {
  APIError,
  type CollectionConfig,
  type CollectionSlug,
  type Config,
  type PayloadRequest,
  type Plugin,
} from 'payload'
import { fieldAffectsData, flattenTopLevelFields } from 'payload/shared'

export type SoftDeleteConfig = {
  collections: Partial<Record<CollectionSlug, true>>
  disabled?: boolean
}

/**
 * Name of the UI-only list-view column added to every protected collection.
 * Its `Cell` component renders the per-row "Soft delete" action button.
 */
export const SOFT_DELETE_ACTION_FIELD = 'softDeleteAction'

type SoftDeleteDocument = {
  isSoftDeleted?: boolean
  softDeletedAt?: null | string
  softDeletedBy?: null | string
}

type SoftDeleteUpdateOptions = {
  collection: string
  id: number | string
  req: PayloadRequest
  overrideAccess: boolean
  data: Record<string, unknown>
}

const hasFieldName = (fields: CollectionConfig['fields'], name: string): boolean =>
  fields.some((field) => 'name' in field && field.name === name)

/**
 * Recreates Payload's default "initial columns" behaviour (useAsTitle plus the
 * first few visible data fields) so the soft-delete action column can be
 * appended to `admin.defaultColumns` without replacing the user's default
 * selection on collections that do not define one.
 */
const getNaturalDefaultColumns = (collection: CollectionConfig): string[] => {
  const useAsTitle = collection.admin?.useAsTitle
  const columns: string[] = []

  if (useAsTitle) {
    columns.push(useAsTitle)
  }

  const flattened = flattenTopLevelFields(collection.fields, {
    keepPresentationalFields: true,
    moveSubFieldsToTop: true,
  })

  for (const field of flattened) {
    const fieldName =
      field && typeof field === 'object' && 'name' in field && field.name ? field.name : undefined
    if (!fieldName || fieldName === useAsTitle) continue
    if (!fieldAffectsData(field)) continue
    if ('admin' in field && field.admin?.disableListColumn === true) continue

    columns.push(fieldName)
    if (columns.length >= 4) break
  }

  return columns
}

export const softDelete = (pluginOptions: SoftDeleteConfig): Plugin => {
  return (config: Config): Config => {
    if (pluginOptions.disabled) return config

    return {
      ...config,
      collections: (config.collections ?? []).map((collection) => {
        if (!pluginOptions.collections[collection.slug]) return collection

        const existingEndpoints = Array.isArray(collection.endpoints) ? collection.endpoints : []
        const existingHooks = collection.hooks ?? {}
        const hasActionColumn = !hasFieldName(collection.fields, SOFT_DELETE_ACTION_FIELD)

        const isSoftDeletedField = {
          name: 'isSoftDeleted',
          type: 'checkbox' as const,
          defaultValue: false,
          index: true,
          admin: {
            disableListColumn: true,
            position: 'sidebar' as const,
            // Hide the checkbox from the admin edit screen entirely; it is only
            // ever toggled through the plugin's soft-delete endpoint.
            condition: () => false,
          },
        }

        const softDeletedAtField = {
          name: 'softDeletedAt',
          type: 'date' as const,
          index: true,
          admin: {
            disableListColumn: true,
            position: 'sidebar' as const,
            condition: () => false,
          },
        }

        const softDeletedByField = {
          name: 'softDeletedBy',
          type: 'text' as const,
          admin: {
            disableListColumn: true,
            position: 'sidebar' as const,
            condition: () => false,
          },
        }

        // Presentational-only field. It is never persisted; its Cell renders the
        // per-row "Soft delete" button in the admin list view.
        const softDeleteActionField = {
          name: SOFT_DELETE_ACTION_FIELD,
          type: 'ui' as const,
          admin: {
            disableListColumn: false,
            position: 'sidebar' as const,
            width: '160px',
            components: {
              Cell: 'soft-delete/client#SoftDeleteCell',
            },
          },
        }

        return {
          ...collection,
          // Never let Payload's native trash feature handle these collections.
          // Soft delete is an audit update on our own fields, nothing else.
          trash: false,
          access: {
            ...collection.access,
            // Block native delete everywhere: Admin UI, REST, GraphQL and the
            // Local API (unless `overrideAccess: true` is explicitly passed).
            delete: () => false,
          },
          admin: {
            ...collection.admin,
            defaultColumns: [
              ...(collection.admin?.defaultColumns?.length
                ? collection.admin.defaultColumns
                : getNaturalDefaultColumns(collection)),
              ...(hasActionColumn ? [SOFT_DELETE_ACTION_FIELD] : []),
            ],
          },
          fields: [
            ...collection.fields,
            ...(hasFieldName(collection.fields, 'isSoftDeleted') ? [] : [isSoftDeletedField]),
            ...(hasFieldName(collection.fields, 'softDeletedAt') ? [] : [softDeletedAtField]),
            ...(hasFieldName(collection.fields, 'softDeletedBy') ? [] : [softDeletedByField]),
            ...(hasActionColumn ? [softDeleteActionField] : []),
          ],
          endpoints: [
            ...existingEndpoints,
            {
              path: '/:id/soft-delete',
              method: 'post' as const,
              handler: async (req: PayloadRequest) => {
                const id = req.routeParams?.id
                if (!id) {
                  throw new APIError(
                    `Missing document id for soft delete on "${collection.slug}". Use POST /api/${collection.slug}/:id/soft-delete`,
                    400,
                  )
                }

                const doc = await req.payload.update({
                  collection: collection.slug,
                  id,
                  req,
                  overrideAccess: false,
                  data: {
                    isSoftDeleted: true,
                    softDeletedAt: new Date().toISOString(),
                    softDeletedBy: req.user?.id ? String(req.user.id) : null,
                  },
                } as unknown as SoftDeleteUpdateOptions)

                return Response.json({ doc, message: 'Soft deleted successfully.' })
              },
            },
          ],
          hooks: {
            ...existingHooks,
            beforeDelete: [
              ...(existingHooks.beforeDelete ?? []),
              () => {
                throw new APIError(
                  `Permanent deletion is disabled for "${collection.slug}". Use the soft-delete endpoint instead.`,
                  403,
                )
              },
            ],
            beforeChange: [
              ...(existingHooks.beforeChange ?? []),
              ({ data, operation, originalDoc, req }) => {
                const incoming = data as SoftDeleteDocument
                const original = originalDoc as SoftDeleteDocument | undefined

                // No matter which API path flips `isSoftDeleted` to true (REST
                // PATCH, Local API, or the plugin endpoint), keep the audit
                // fields consistent: record when and by whom it was soft-deleted.
                if (
                  operation === 'update' &&
                  incoming.isSoftDeleted === true &&
                  original?.isSoftDeleted !== true
                ) {
                  if (!incoming.softDeletedAt) {
                    incoming.softDeletedAt = new Date().toISOString()
                  }
                  if (incoming.softDeletedBy === undefined) {
                    incoming.softDeletedBy = req.user?.id ? String(req.user.id) : null
                  }
                }

                return incoming
              },
            ],
          },
        }
      }),
    }
  }
}