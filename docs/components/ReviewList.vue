<script setup>
import { ref, onMounted } from 'vue'

const reviews = ref([])

onMounted(() => {
  const saved = localStorage.getItem('wrong_answers')
  if (saved) {
    reviews.value = JSON.parse(saved).sort((a, b) => b.timestamp - a.timestamp)
  }
})

function removeReview(index) {
  reviews.value.splice(index, 1)
  localStorage.setItem('wrong_answers', JSON.stringify(reviews.value))
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString()
}
</script>

<template>
  <div class="review-list">
    <div v-if="reviews.length === 0" class="empty">
      🎉 No pending reviews! Great job!
    </div>
    <div v-else>
      <div class="stats">
        You have <strong>{{ reviews.length }}</strong> questions to review.
      </div>
      <div v-for="(item, index) in reviews" :key="index" class="review-item">
        <div class="info">
          <span class="date">{{ formatDate(item.timestamp) }}</span>
          <a :href="item.path + '#' + item.anchorId" class="link">
            Go to Question {{ item.questionId }}
          </a>
        </div>
        <button @click="removeReview(index)" class="remove-btn" title="Remove from list">
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-list {
  margin-top: 2rem;
}
.empty {
  text-align: center;
  padding: 2rem;
  background: #f0fdf4;
  color: #15803d;
  border-radius: 8px;
  font-size: 1.1rem;
}
.stats {
  margin-bottom: 1rem;
  color: #666;
}
.review-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  margin-bottom: 0.5rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  transition: all 0.2s;
}
.review-item:hover {
  border-color: #3eaf7c;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.date {
  font-size: 0.85rem;
  color: #9ca3af;
}
.link {
  color: #3eaf7c;
  font-weight: 500;
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
.remove-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #9ca3af;
  cursor: pointer;
  padding: 0 0.5rem;
  transition: color 0.2s;
}
.remove-btn:hover {
  color: #ef4444;
}
</style>
