import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import path from 'path';

const monaco = (monacoEditorPlugin as unknown as { default?: typeof monacoEditorPlugin }).default ?? monacoEditorPlugin;

export default defineConfig({
  plugins: [
    react(),
    monaco({
      languageWorkers: ['editorWorkerService', 'typescript'],
      customWorkers: [
        {
          label: 'claro',
          entry: 'monaco-editor-core/esm/vs/editor/editor.worker',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@project/dsl': path.resolve(__dirname, '../../packages/dsl/src/index.ts'),
      '@project/contracts': path.resolve(__dirname, '../../contracts/src/index.ts'),
      '@project/ai': path.resolve(__dirname, '../../packages/ai/src/index.ts'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});