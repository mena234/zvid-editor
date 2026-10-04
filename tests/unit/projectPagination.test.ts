import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'

it('cloud project pagination preserves loaded rows and retries a failed page', async () => {
  const source = readFileSync(new URL('../../components/modals/ProjectsModal.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const responses = [
    { success: true, projects: [{ id: 'first' }], pagination: { totalPages: 2 } },
    { success: false, error: 'Try again' },
    { success: true, projects: [{ id: 'second' }], pagination: { totalPages: 2 } },
  ]
  const requestedPages: number[] = []
  const code = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const page = vm.runInNewContext(`(() => { ${code}
    return { rows, load, loadMore, hasMore, loadMoreError };
  })()`, {
    exports: {},
    $fetch: async (_url: string, options: any) => {
      requestedPages.push(options.query.page)
      return responses.shift()
    },
    require(id: string) {
      if (id === 'vue') return { ref, onMounted() {} }
      if (id === '~/stores/auth') return { useAuthStore: () => ({ plan: { maxProjects: null } }) }
      if (id === '~/stores/project') return { useProjectStore: () => ({}) }
      if (id === '~/stores/editor') return { useEditorStore: () => ({}) }
      if (id === '~/composables/useCloud') return { useCloud: () => ({ handleExpired: () => false }) }
      throw new Error(`Unexpected import ${id}`)
    },
  })
  await page.load()
  await page.loadMore()
  expect(page.rows.value.map((row: any) => row.id)).toEqual(['first'])
  expect(page.loadMoreError.value).toBe('Try again')
  await page.loadMore()
  expect(page.rows.value.map((row: any) => row.id)).toEqual(['first', 'second'])
  expect(page.hasMore.value).toBe(false)
  expect(requestedPages).toEqual([1, 2, 2])
})
