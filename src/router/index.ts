import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import DashboardPage from '../views/admin/DashboardPage.vue'
import BasicDataPage from '../views/admin/BasicDataPage.vue'
import RuleSettingsPage from '../views/admin/RuleSettingsPage.vue'
import SchedulesPage from '../views/admin/SchedulesPage.vue'
import ScheduleWorkbenchPage from '../views/admin/ScheduleWorkbenchPage.vue'
import TimetableManagementPage from '../views/admin/TimetableManagementPage.vue'
import { getCurrentUser, isAuthenticated } from '../services/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AdminLayout,
      meta: { requiresAuth: true, role: 'admin' },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: DashboardPage },
        { path: 'basic-data', name: 'basicData', component: BasicDataPage },
        { path: 'rule-settings', name: 'ruleSettings', component: RuleSettingsPage },
        { path: 'schedules', name: 'schedules', component: SchedulesPage },
        { path: 'timetable-management', name: 'timetableManagement', component: TimetableManagementPage },
        { path: 'schedules/workbench', name: 'scheduleWorkbench', component: ScheduleWorkbenchPage }
      ]
    }
  ]
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) {
    return { name: 'login' }
  }

  if (to.name === 'login' && isAuthenticated()) {
    return { name: 'dashboard' }
  }

  const requiredRole = to.meta.role as string | undefined
  if (requiredRole) {
    const currentUser = getCurrentUser()
    if (!currentUser || currentUser.role !== requiredRole) {
      return { name: 'login' }
    }
  }

  return true
})

export default router
