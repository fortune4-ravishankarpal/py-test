import { fileURLToPath } from 'node:url'

type ComponentSpecifierConfig = {
    packageName: string // '@payload-pln/soft-delete'
    localAlias?: string // '@/plugins/soft-delete'
}

export const createComponentResolver = (config: ComponentSpecifierConfig) => {
    const { packageName, localAlias } = config
    if (!localAlias) {
        throw new Error("localAlias is required")
    }

    return (componentName: string): string => {
        const currentFile = fileURLToPath(import.meta.url)
        const isNodeModule = currentFile.includes('node_modules')

        const basePath = isNodeModule ? packageName : localAlias
        return `${basePath}/client#${componentName}`
    }
}

// Instantiate with just 2 properties!
export const getClientComponent = createComponentResolver({
    packageName: '@payload-pln/soft-delete',
    localAlias: '@/plugins/soft-delete',
})