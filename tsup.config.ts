import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts', 'src/client.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external: ['react', 'react-dom', 'payload', '@payloadcms/ui', 'next'],
    banner: {
        // Preserve 'use client' for client component exports
        js: "/* soft-delete */",
    },
})