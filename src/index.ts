import type { CollectionSlug, Config, Plugin } from 'payload'

export type SoftDeleteConfig = {
  collections: Partial<Record<CollectionSlug, true>>
  disabled?: boolean
}

type SoftDeleteDocument = {
  isSoftDeleted?: boolean
  softDeletedAt?: null | string
  softDeletedBy?: null | string
}

export const softDelete = (pluginOptions: SoftDeleteConfig): Plugin => {
  return (config: Config): Config => {
    if (pluginOptions.disabled) return config

    return {
      ...config,
      collections: (config.collections ?? []).map((collection) => {
        if (!pluginOptions.collections[collection.slug]) return collection

        const existingFieldNames = new Set(
          collection.fields
            .filter(
              (field): field is typeof field & { name: string } =>
                'name' in field,
            )
            .map((field) => field.name),
        )
        const existingEndpoints = Array.isArray(collection.endpoints) ? collection.endpoints : []
        return {
          ...collection,

          fields: [
            ...collection.fields,

            ...(existingFieldNames.has('isSoftDeleted')
              ? []
              : [
                {
                  name: 'isSoftDeleted',
                  type: 'checkbox' as const,
                  defaultValue: false,
                  index: true,
                  admin: {
                    hidden: true,
                    disableListColumn: true
                  },
                },
              ]),

            ...(existingFieldNames.has('softDeletedBy')
              ? []
              : [
                {
                  name: 'softDeletedBy',
                  type: 'text' as const,
                  admin: {
                    hidden: true,
                    disableListColumn: true
                  },
                },
              ]),

            ...(existingFieldNames.has('softDeletedAt')
              ? []
              : [
                {
                  name: 'softDeletedAt',
                  type: 'date' as const,
                  index: true,
                  admin: {
                    hidden: true,
                    disableListColumn: true
                  },
                },
              ]),
          ],

          endpoints: [
            ...(existingEndpoints),
            {
              path: '/:id',
              method: 'delete',
              handler: async (req) => {
                const id = req.routeParams?.id as string

                // 1. Perform soft-delete update instead of hard deletion
                const doc = await req.payload.update({
                  collection: collection.slug,
                  id,
                  data: {
                    isSoftDeleted: true,
                    softDeletedAt: new Date().toISOString(),
                    softDeletedBy: req.user?.id ? String(req.user.id) : null,
                  },
                  req,
                })

                // 2. Return standard Payload success response expected by Admin UI / REST
                return Response.json({
                  message: 'Deleted successfully.',
                  doc,
                })
              },
            },
          ],

          hooks: {
            ...(collection.hooks ?? {}),

            // Automatically filter out soft-deleted records from queries
            beforeOperation: [
              ...(collection.hooks?.beforeOperation ?? []),

              ({ args, operation }) => {
                if (operation === 'read' && 'where' in args) {
                  args.where = {
                    and: [
                      args.where || {},
                      {
                        or: [
                          { isSoftDeleted: { equals: false } },
                          { isSoftDeleted: { exists: false } },
                        ],
                      },
                    ],
                  }
                }
                return args
              },
            ],

            beforeRead: [
              ...(collection.hooks?.beforeRead ?? []),

              ({ doc }) => {
                const softDeleteDoc = doc as SoftDeleteDocument

                if (softDeleteDoc.isSoftDeleted === undefined) {
                  softDeleteDoc.isSoftDeleted = false
                }

                return softDeleteDoc
              },
            ],
          },
        }
      }),
    }
  }
}