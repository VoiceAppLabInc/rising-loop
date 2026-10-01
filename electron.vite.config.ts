import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        // index: アプリの周り（タブ・設定）用。loops: ループの画面（スキルの HTML）用
        input: { index: resolve('src/preload/index.ts'), loops: resolve('src/preload/loops.ts') }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias }
  }
})
