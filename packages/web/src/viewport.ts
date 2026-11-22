import { readonly, ref } from 'vue'

const query = window.matchMedia('(min-width: 840px)')
const desktop = ref(query.matches)
query.addEventListener('change', (e) => (desktop.value = e.matches))

export const isDesktop = readonly(desktop)
