import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    /**
     * Git worktrees live inside the repo, so the default globs sweep up every
     * other branch's tests and `pnpm test` reports a number for code that is
     * not checked out. Each worktree runs its own suite.
     */
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
  },
})
