import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser, hasPermission, hasRequiredRole, isAuthenticated } from '../services/auth'
import type { AuthRole } from '../types/auth'

const LoginView = () => import('../views/LoginView.vue')
const PasswordResetView = () => import('../views/PasswordResetView.vue')
const AdminLayout = () => import('../layouts/AdminLayout.vue')
const DashboardPage = () => import('../views/admin/DashboardPage.vue')
const UserManagementPage = () => import('../views/admin/UserManagementPage.vue')
const BasicDataPage = () => import('../views/admin/BasicDataPage.vue')
const RuleSettingsPage = () => import('../views/admin/RuleSettingsPage.vue')
const SchedulesPage = () => import('../views/admin/SchedulesPage.vue')
const ScheduleWorkbenchPage = () => import('../views/admin/ScheduleWorkbenchPage.vue')
const TeacherHoursStatisticsPage = () => import('../views/admin/TeacherHoursStatisticsPage.vue')
const TimetableManagementPage = () => import('../views/admin/TimetableManagementPage.vue')
const HelpCenterPage = () => import('../views/admin/HelpCenterPage.vue')
const SchoolFeatureConfigPage = () => import('../views/admin/SchoolFeatureConfigPage.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/password-reset', name: 'passwordReset', component: PasswordResetView },
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
