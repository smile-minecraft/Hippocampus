<script setup>
import { ref, onMounted } from 'vue'
import { useData } from 'vitepress'

const props = defineProps({
  id: String,
  question: String,
  options: Array,
  answer: Number, // 0-based index
  explanation: String
})

const { page } = useData()
const selected = ref(null)
const showExp = ref(false)
const showReviewBtn = ref(false)

// Check if this question is in the review list
onMounted(() => {
  const saved = localStorage.getItem('wrong_answers')
  if (saved) {
    const list = JSON.parse(saved)
    const exists = list.some(item => 
      item.pageId === page.value.relativePath && item.questionId === props.id
    )
    if (exists) showReviewBtn.value = true
  }
})

function check(idx) {
  selected.value = idx
  showExp.value = true

  if (idx !== props.answer) {
    // Save to wrong_answers
    const saved = localStorage.getItem('wrong_answers')
    let list = saved ? JSON.parse(saved) : []
    
    // Check if already exists to avoid duplicates
    const exists = list.some(item => 
      item.pageId === page.value.relativePath && item.questionId === props.id
    )
    
    if (!exists) {
      list.push({
        pageId: page.value.relativePath,
        questionId: props.id,
        path: page.value.relativePath.replace(/\.md$/, '.html'),
        anchorId: 'q' + props.id,
        timestamp: Date.now()
      })
      localStorage.setItem('wrong_answers', JSON.stringify(list))
      showReviewBtn.value = true
    }
  }
}

function markReviewed() {
  const saved = localStorage.getItem('wrong_answers')
  if (saved) {
    let list = JSON.parse(saved)
    list = list.filter(item => 
      !(item.pageId === page.value.relativePath && item.questionId === props.id)
    )
    localStorage.setItem('wrong_answers', JSON.stringify(list))
    showReviewBtn.value = false
  }
}
</script>

<template>
  <div :id="'q' + id" class="quiz-card">
    <div class="q-header">
      <div class="q-text"><strong>Q{{ id }}</strong> {{ question }}</div>
      <button v-if="showReviewBtn && selected === answer" 
              @click="markReviewed" 
              class="review-btn">
        Mark as Reviewed
      </button>
    </div>
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
.quiz-card { border: 1px solid #ddd; padding: 1rem; margin: 1rem 0; border-radius: 8px; scroll-margin-top: 80px; }
.q-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.q-text { flex: 1; margin-right: 1rem; }
.review-btn { background: #3eaf7c; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
.review-btn:hover { background: #2c8f61; }
.opt { padding: 8px; margin: 5px 0; border: 1px solid #eee; cursor: pointer; border-radius: 4px; }
.opt:hover { background: #f9f9f9; }
.correct { background: #d1fae5; border-color: #10b981; }
.wrong { background: #fee2e2; border-color: #ef4444; }
.exp { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc; color: #666; }
</style>
