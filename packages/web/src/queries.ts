import { api } from './api.ts'

export const dashboardQuery = {
  queryKey: ['dashboard'],
  queryFn: async () => {
    const res = await api.dashboard.$get({ query: {} })
    if (!res.ok) throw new Error(`dashboard: ${res.status}`)
    return res.json()
  },
}

export const conflictsQuery = {
  queryKey: ['conflicts'],
  queryFn: async () => {
    const res = await api.conflicts.$get()
    if (!res.ok) throw new Error(`conflicts: ${res.status}`)
    return res.json()
  },
}

export const configQuery = {
  queryKey: ['config'],
  queryFn: async () => {
    const res = await api.config.$get()
    if (!res.ok) throw new Error(`config: ${res.status}`)
    return res.json()
  },
}
