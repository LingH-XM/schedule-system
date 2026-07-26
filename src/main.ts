import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import './styles/global.css'
import './styles/typography.css'
import './styles/spacing.css'
import './styles/text-colors.css'
import './styles/table-system.css'
import './styles/navigation-system.css'

createApp(App).use(router).use(ElementPlus, { locale: zhCn }).mount('#app')
