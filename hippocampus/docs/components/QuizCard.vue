<script setup>
import { ref } from 'vue'
const props = defineProps({
  id: String,
  question: String,
  options: Array,
  answer: Number, // 0-based index
  explanation: String
})
const selected = ref(null)
const showExp = ref(false)
function check(idx) { selected.value = idx; showExp.value = true; }
</script>

<template>
  <div class="quiz-card">
    <div class="q-text"><strong>Q{{ id }}</strong> {{ question }}</div>
    <div class="opts">
      <div v-for="(opt, i) in options" :key="i" 
           @click="check(i)"
           class="opt"
           :class="{ 
             'correct': showExp && i === answer,
             'wrong': showExp && selected === i && i !== answer
           }">
        {{ opt }}
      </div>
    </div>
    <div v-if="showExp" class="exp" v-html="explanation"></div>
  </div>
</template>

<style scoped>
.quiz-card { border: 1px solid #ddd; padding: 1rem; margin: 1rem 0; border-radius: 8px; }
.opt { padding: 8px; margin: 5px 0; border: 1px solid #eee; cursor: pointer; border-radius: 4px; }
.opt:hover { background: #f9f9f9; }
.correct { background: #d1fae5; border-color: #10b981; }
.wrong { background: #fee2e2; border-color: #ef4444; }
.exp { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc; color: #666; }
</style>
