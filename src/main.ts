import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { installElementPlus } from './plugins/elementPlus'
import './styles/global.css'
import './styles/typography.css'
import './styles/spacing.css'
import './styles/text-colors.css'
import './styles/table-system.css'
import './styles/navigation-system.css'

const app = createApp(App)

installElementPlus(app)
app.use(router)
app.mount('#app')
