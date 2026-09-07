import {
  APIError,
  type Access,
  type CollectionConfig,
  type CollectionSlug,
  type Config,
  type PayloadRequest,
  type Plugin,
  type Where,
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

type SoftDeleteUpdateOptions = {
  collection: string
  id: number | string
  req: PayloadRequest
  overrideAccess: boolean
  data: Record<string, unknown>
}

const hasFieldName = (fields: CollectionConfig['fields'], name: string): boolean =>
  fields.some((field) => 'name' in field && field.name === name)

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
        const existingReadAccess: Access = collection.access?.read ?? (() => true)
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

        // Condition to restrict queries to non-soft-deleted items
        const softDeleteWhere: Where = {
          or: [
            { isSoftDeleted: { equals: false } },
            { isSoftDeleted: { exists: false } },
          ],
        }

        return {
          ...collection,
          // Never let Payload's native trash feature handle these collections.
          // Soft delete is an audit update on our own fields, nothing else.
          trash: false,
          access: {
            ...collection.access,
            // Combine existing read access constraints with soft delete filtering
            read: async (args) => {
              const baseAccess = await existingReadAccess(args)

              // If read access is explicitly denied, return false
              if (!baseAccess) return false

              // If read access returns a specific query (Where object), combine it
              if (typeof baseAccess === 'object') {
                return {
                  and: [baseAccess, softDeleteWhere],
                }
              }

              // Otherwise return the soft delete filter rule directly
              return softDeleteWhere
            },
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
          },
        }
      }),
    }
  }
}