import type { CollectionSlug, Config, Plugin } from 'payload'

export type SoftDeleteConfig = {
  collections: Partial<Record<CollectionSlug, true>>
  disabled?: boolean
}

type SoftDeleteDocument = {
  deletedAt?: null | string
  isSoftDeleted?: boolean
  softDeletedAt?: null | string
  softDeletedBy?: null | string
}

export const softDelete = (pluginOptions: SoftDeleteConfig): Plugin => {
  return (config: Config): Config => {
    if (pluginOptions.disabled) return config

    const protectedCollections = new Set(
      Object.entries(pluginOptions.collections)
        .filter(([, enabled]) => enabled)
        .map(([slug]) => slug),
    )
    const incomingOnInit = config.onInit

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

        const existingEndpoints = Array.isArray(collection.endpoints)
          ? collection.endpoints
          : []

        return {
          ...collection,
          // Payload's trash implementation turns Admin deletion into an update of
          // `deletedAt` and automatically excludes trashed documents from reads.
          trash: true,

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
                    disableListColumn: true,
                    position: 'sidebar' as const,
                    // Returning false cleanly hides the field from the UI edit screen
                    // without restricting database query paths
                    condition: () => false,
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
                    disableListColumn: true,
                    position: 'sidebar' as const,
                    condition: () => false,
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
                    disableListColumn: true,
                    position: 'sidebar' as const,
                    condition: () => false,
                  },
                },
              ]),
          ],

          endpoints: [
            ...existingEndpoints,
            {
              path: '/',
              method: 'delete',
              handler: async (req) => {
                const { where } = await req.json?.() ?? {}
                const result = await req.payload.update({
                  collection: collection.slug,
                  data: { deletedAt: new Date().toISOString() },
                  req,
                  where,
                })

                return Response.json(result)
              },
            },
            {
              path: '/:id',
              method: 'delete',
              handler: async (req) => {
                const id = req.routeParams?.id as string
                const deletedAt = new Date().toISOString()

                const doc = await req.payload.update({
                  collection: collection.slug,
                  id,
                  data: {
                    deletedAt,
                  },
                  req,
                })

                return Response.json({
                  message: 'Deleted successfully.',
                  doc,
                })
              },
            },
          ],

          hooks: {
            ...(collection.hooks ?? {}),

            beforeChange: [
              ...(collection.hooks?.beforeChange ?? []),
              ({ data, operation, originalDoc, req }) => {
                const incoming = data as SoftDeleteDocument
                const original = originalDoc as SoftDeleteDocument | undefined

                if (operation === 'update' && incoming.deletedAt && !original?.deletedAt) {
                  incoming.isSoftDeleted = true
                  incoming.softDeletedAt = incoming.deletedAt
                  incoming.softDeletedBy = req.user?.id ? String(req.user.id) : null
                }

                if (operation === 'update' && incoming.deletedAt === null && original?.deletedAt) {
                  incoming.isSoftDeleted = false
                  incoming.softDeletedAt = null
                  incoming.softDeletedBy = null
                }

                return incoming
              },
            ],

            beforeRead: [
              ...(collection.hooks?.beforeRead ?? []),

              ({ doc }) => {
                const softDeleteDoc = doc as SoftDeleteDocument

                if (softDeleteDoc.deletedAt && softDeleteDoc.isSoftDeleted === undefined) {
                  softDeleteDoc.isSoftDeleted = true
                }

                return softDeleteDoc
              },
            ],
          },
        }
      }),
      onInit: async (payload) => {
        await incomingOnInit?.(payload)

        const originalDelete = payload.delete.bind(payload)

        // Collection endpoints do not run for `payload.delete()`. Wrap the Local
        // API as well so the same call becomes a soft-delete for protected slugs.
        ;(payload as typeof payload & { delete: (options: any) => Promise<any> }).delete = async (options) => {
          if (!protectedCollections.has(options.collection)) {
            return originalDelete(options)
          }

          const data = { deletedAt: new Date().toISOString() }

          if (options.id) {
            return payload.update({
              collection: options.collection,
              id: options.id,
              data,
              req: options.req,
              overrideAccess: options.overrideAccess,
              overrideLock: options.overrideLock,
            })
          }

          return payload.update({
            collection: options.collection,
            data,
            where: options.where,
            req: options.req,
            overrideAccess: options.overrideAccess,
            overrideLock: options.overrideLock,
          })
        }
      },
    }
  }
}
