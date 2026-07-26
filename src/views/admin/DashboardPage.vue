<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <article class="panel dashboard-panel">
    <div class="dashboard-intro">
      <h1>控制台</h1>
      <p>欢迎使用排课系统管理员后台。你可以在左侧导航进入各业务模块。</p>
    </div>

    <section class="dashboard-guide">
      <div>
        <h2>第一次使用排课系统？</h2>
        <p>按照从基础数据、规则设置到生成课表的完整流程，逐步完成一次排课。</p>
      </div>
      <RouterLink class="dashboard-guide-link" to="/help">查看使用说明</RouterLink>
    </section>
  </article>
</template>

<style scoped>
.dashboard-panel {
  display: grid;
  gap: var(--space-6);
}

.dashboard-intro p {
  margin-bottom: 0;
  color: var(--text-secondary);
}

.dashboard-guide {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-6);
  border: 1px solid #dfe4ed;
  border-radius: 10px;
  background: #fafbfc;
}

.dashboard-guide h2 {
  margin: 0;
  color: var(--text-heading);
  font-size: 19px;
}

.dashboard-guide p {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.dashboard-guide-link {
  flex: 0 0 auto;
  padding: 10px var(--space-4);
  border: 1px solid #b9d7fb;
  border-radius: 7px;
  background: #fff;
  color: var(--text-link);
  font-size: 14px;
  font-weight: 600;
}

.dashboard-guide-link:hover {
  border-color: #83bafa;
  background: #f7fbff;
  color: var(--text-link-hover);
}

@media (max-width: 680px) {
  .dashboard-guide {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
