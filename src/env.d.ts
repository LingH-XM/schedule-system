/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASIC_DATA_SOURCE?: 'local' | 'api'
  readonly VITE_RULE_SETTINGS_SOURCE?: 'local' | 'api'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_PROFILE?: 'test' | 'prod'
  readonly VITE_BASIC_DATA_PLAN_ID?: string
  readonly VITE_RULE_SETTINGS_PLAN_ID?: string
  readonly VITE_SCHEDULE_STATE_SOURCE?: 'local' | 'api'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
