import DefaultTheme from 'vitepress/theme'
import QuizCard from '../../components/QuizCard.vue'

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.component('QuizCard', QuizCard)
    }
}
