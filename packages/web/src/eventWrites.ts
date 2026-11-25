import type { QueryClient } from '@tanstack/vue-query'

const AFFECTED = ['dashboard', 'events', 'conflicts', 'cardTags', 'cardInputs', 'rootTags', 'pure', 'media', 'search', 'days']

export function refetchAfterEventWrite(queryClient: QueryClient) {
  for (const key of AFFECTED) queryClient.invalidateQueries({ queryKey: [key] })
  // Closed report sheets refetch now, so reopening one shows the change at once.
  queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['sleepAnalysis'], refetchType: 'all' })
}
