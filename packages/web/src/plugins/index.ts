import type { PAD_ROWS } from 'server/config'
import type { Component } from 'vue'
import WeightSteps from './weight/WeightSteps.vue'

/** The component behind each keypad row a value setting can name in `pad`. */
export const PAD_ROW_COMPONENTS: Record<(typeof PAD_ROWS)[number], Component> = {
  weight: WeightSteps,
}
