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
import DesignShowcaseView from '../views/DesignShowcaseView.vue'
import SchoolFeatureConfigPage from '../views/admin/SchoolFeatureConfigPage.vue'
import { getCurrentUser, hasPermission, hasRequiredRole, isAuthenticated } from '../services/auth'
import type { AuthRole } from '../types/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/design-showcase', name: 'designShowcase', component: DesignShowcaseView },
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
        { path: 'users', name: 'userManagement', component: UserManagementPage, meta: { requiresAuth: true, role: 'school_admin' } },
        { path: 'school-features', name: 'schoolFeatures', component: SchoolFeatureConfigPage, meta: { requiresAuth: true, role: 'super_admin' } },
        { path: 'basic-data', name: 'basicData', component: BasicDataPage, meta: { permission: 'basic_data.read' } },
        { path: 'rule-settings', name: 'ruleSettings', component: RuleSettingsPage, meta: { permission: 'rules.read' } },
        { path: 'schedules', name: 'schedules', component: SchedulesPage, meta: { permission: 'schedule.read' } },
        { path: 'teacher-hours-statistics', name: 'teacherHoursStatistics', component: TeacherHoursStatisticsPage, meta: { permission: 'timetable.read' } },
        { path: 'timetable-management', name: 'timetableManagement', component: TimetableManagementPage, meta: { permission: 'timetable.read' } },
        { path: 'schedules/workbench', name: 'scheduleWorkbench', component: ScheduleWorkbenchPage, meta: { permission: 'schedule.read' } }
      ]
    }
  ]
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && isAuthenticated()) {
    return { name: 'dashboard' }
  }

  const requiredRole = to.meta.role as string | undefined
  if (requiredRole) {
    const currentUser = getCurrentUser()
    if (!currentUser || !hasRequiredRole(currentUser.role, requiredRole as AuthRole)) {
      return { name: 'dashboard' }
    }
  }

  const requiredPermission = to.meta.permission as string | undefined
  if (requiredPermission && !hasPermission(requiredPermission)) return { name: 'dashboard' }

  return true
})

export default router
