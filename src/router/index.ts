import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import DashboardPage from '../views/admin/DashboardPage.vue'
import UserManagementPage from '../views/admin/UserManagementPage.vue'
import BasicDataPage from '../views/admin/BasicDataPage.vue'
import RuleSettingsPage from '../views/admin/RuleSettingsPage.vue'
import SchedulesPage from '../views/admin/SchedulesPage.vue'
import ScheduleWorkbenchPage from '../views/admin/ScheduleWorkbenchPage.vue'
import TeacherHoursStatisticsPage from '../views/admin/TeacherHoursStatisticsPage.vue'
import TimetableManagementPage from '../views/admin/TimetableManagementPage.vue'
import HelpCenterPage from '../views/admin/HelpCenterPage.vue'
import { getCurrentUser, hasRequiredRole, isAuthenticated } from '../services/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/help/:page?',
      name: 'helpCenter',
      component: HelpCenterPage,
      meta: { requiresAuth: true }
    },
    {
      path: '/',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: DashboardPage },
        { path: 'users', name: 'userManagement', component: UserManagementPage, meta: { requiresAuth: true, role: 'super_admin' } },
        { path: 'basic-data', name: 'basicData', component: BasicDataPage },
        { path: 'rule-settings', name: 'ruleSettings', component: RuleSettingsPage },
        { path: 'schedules', name: 'schedules', component: SchedulesPage },
        { path: 'teacher-hours-statistics', name: 'teacherHoursStatistics', component: TeacherHoursStatisticsPage },
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
    if (!currentUser || !hasRequiredRole(currentUser.role, requiredRole as 'super_admin' | 'admin')) {
      return { name: 'dashboard' }
    }
  }

  return true
})

export default router
