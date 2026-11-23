import { useMutation, useQueryClient } from '@tanstack/vue-query'
import type { Config, Layout } from 'server/config'
import { api } from './api.ts'

export function useLayoutSave() {
  const queryClient = useQueryClient()
  const show = (next: Layout) => queryClient.setQueryData<Config>(['config'], (config) => config && { ...config, layout: next })
  const mutation = useMutation({
    mutationFn: async (next: Layout) => {
      const res = await api.layout.$put({ json: next })
      if (!res.ok) throw new Error(`layout: ${res.status}`)
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  })
  return {
    show,
    save: (next: Layout) => {
      show(next)
      mutation.mutate(next)
    },
  }
}
