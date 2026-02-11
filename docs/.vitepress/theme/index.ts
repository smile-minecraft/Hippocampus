import DefaultTheme from 'vitepress/theme'
import './style.css'
import QuizCard from '../../components/QuizCard.vue'
import ReviewList from '../../components/ReviewList.vue'
import mediumZoom from 'medium-zoom'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute, type EnhanceAppContext } from 'vitepress'

export default {
    extends: DefaultTheme,
    enhanceApp({ app }: EnhanceAppContext) {
        app.component('QuizCard', QuizCard)
        app.component('ReviewList', ReviewList)
    },

    setup() {
        const route = useRoute()
        const initZoom = () => {
            // new mediumZoom('.main img', { background: 'var(--vp-c-bg)' }) // simple usage
            mediumZoom('.main img', { background: 'var(--vp-c-bg)' })
        }
        onMounted(() => {
            initZoom()
        })
        watch(
            () => route.path,
            () => nextTick(() => initZoom())
        )
    }
}
