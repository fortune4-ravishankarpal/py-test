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

export const SOFT_DELETE_ACTION_FIELD = 'deleteAction'

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

        const softDeleteActionField = {
          name: SOFT_DELETE_ACTION_FIELD,
          type: 'ui' as const,
          admin: {
            disableListColumn: false,
            position: 'sidebar' as const,
            width: '160px',
            components: {
              Cell: 'soft-delete/client#SoftDeleteCell',
              // Field: 'soft-delete/client#SoftDeleteButton',
            },
          },
        }

        const softDeleteWhere: Where = {
          or: [
            { isSoftDeleted: { equals: false } },
            { isSoftDeleted: { exists: false } },
          ],
        }

        const existingActions = collection.admin?.components?.edit?.editMenuItems ?? []

        return {
          ...collection,
          trash: false,
          access: {
            ...collection.access,
            read: async (args) => {
              const baseAccess = await existingReadAccess(args)
              if (!baseAccess) return false
              if (typeof baseAccess === 'object') {
                return {
                  and: [baseAccess, softDeleteWhere],
                }
              }
              return softDeleteWhere
            },
            delete: () => false,
          },
          admin: {
            ...collection.admin,
            components: {
              ...collection.admin?.components,
              edit: {
                ...collection.admin?.components?.edit,
                editMenuItems: [
                  ...existingActions,
                  'soft-delete/client#SoftDeleteButton',
                ],
              },
            },
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
                    `Missing document id for soft delete on "${collection.slug}".`,
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

                return Response.json({ doc, message: 'Deleted successfully.' })
              },
            },
          ],
          hooks: {
            ...existingHooks,
            beforeDelete: [
              ...(existingHooks.beforeDelete ?? []),
              () => {
                throw new APIError(
                  `Permanent deletion is disabled for "${collection.slug}".`,
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