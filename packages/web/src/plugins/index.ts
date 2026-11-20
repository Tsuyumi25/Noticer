import type { Component } from 'vue'
import WeightSteps from './weight/WeightSteps.vue'

/** Cards whose keypad swaps the usual-amount row for a row of their own, keyed by card id. */
export const PAD_ROWS: Record<string, Component> = {
  weight: WeightSteps,
}
