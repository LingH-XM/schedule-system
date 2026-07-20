<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'table' | 'form' | 'workbench'
    showSidebar?: boolean
  }>(),
  {
    variant: 'table',
    showSidebar: false
  }
)
</script>

<template>
  <section
    class="content-skeleton"
    :class="[`content-skeleton--${variant}`, { 'content-skeleton--sidebar': showSidebar }]"
    aria-label="正在加载页面内容"
    aria-busy="true"
  >
    <aside v-if="showSidebar" class="content-skeleton__sidebar">
      <el-skeleton animated>
        <template #template>
          <el-skeleton-item variant="h1" class="content-skeleton__sidebar-title" />
          <el-skeleton-item v-for="index in 8" :key="index" variant="text" class="content-skeleton__nav-line" />
        </template>
      </el-skeleton>
    </aside>

    <article class="content-skeleton__main">
      <el-skeleton animated>
        <template #template>
          <div class="content-skeleton__heading">
            <div>
              <el-skeleton-item variant="h1" class="content-skeleton__title" />
              <el-skeleton-item variant="text" class="content-skeleton__subtitle" />
            </div>
            <el-skeleton-item variant="button" class="content-skeleton__primary-action" />
          </div>

          <div class="content-skeleton__toolbar">
            <el-skeleton-item v-for="index in 4" :key="index" variant="rect" />
          </div>

          <template v-if="variant === 'workbench'">
            <div class="content-skeleton__workbench-tabs">
              <el-skeleton-item v-for="index in 6" :key="index" variant="button" />
            </div>
            <div class="content-skeleton__workbench-grid">
              <div class="content-skeleton__course-list">
                <el-skeleton-item v-for="index in 7" :key="index" variant="rect" />
              </div>
              <div v-for="panel in 2" :key="panel" class="content-skeleton__schedule-grid">
                <el-skeleton-item v-for="index in 24" :key="index" variant="rect" />
              </div>
            </div>
          </template>

          <template v-else-if="variant === 'form'">
            <div class="content-skeleton__form">
              <div v-for="row in 6" :key="row" class="content-skeleton__form-row">
                <el-skeleton-item variant="text" />
                <el-skeleton-item variant="rect" />
                <el-skeleton-item variant="rect" />
              </div>
            </div>
          </template>

          <template v-else>
            <div class="content-skeleton__metrics">
              <el-skeleton-item v-for="index in 4" :key="index" variant="rect" />
            </div>
            <div class="content-skeleton__table">
              <el-skeleton-item variant="rect" class="content-skeleton__table-head" />
              <el-skeleton-item v-for="index in 7" :key="index" variant="text" />
            </div>
          </template>
        </template>
      </el-skeleton>
    </article>
  </section>
</template>

<style scoped>
.content-skeleton {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: calc(100vh - 112px);
  padding: 24px;
  border: 1px solid #dbe6fb;
  border-radius: 14px;
  background: #fff;
}

.content-skeleton--sidebar {
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 20px;
  padding: 0;
  border: 0;
  background: transparent;
}

.content-skeleton__sidebar,
.content-skeleton__main {
  min-width: 0;
  padding: 24px;
  border: 1px solid #dbe6fb;
  border-radius: 14px;
  background: #fff;
}

.content-skeleton:not(.content-skeleton--sidebar) .content-skeleton__main {
  padding: 0;
  border: 0;
}

.content-skeleton__sidebar-title {
  width: 52%;
  height: 24px;
  margin-bottom: 28px;
}

.content-skeleton__nav-line {
  display: block;
  width: 78%;
  margin: 0 0 22px 8px;
}

.content-skeleton__heading,
.content-skeleton__toolbar,
.content-skeleton__metrics,
.content-skeleton__workbench-tabs,
.content-skeleton__workbench-grid,
.content-skeleton__form-row {
  display: flex;
  align-items: center;
}

.content-skeleton__heading {
  justify-content: space-between;
  gap: 24px;
}

.content-skeleton__heading > div {
  flex: 1;
}

.content-skeleton__title {
  width: 210px;
  height: 32px;
}

.content-skeleton__subtitle {
  display: block;
  width: min(420px, 70%);
  margin-top: 12px;
}

.content-skeleton__primary-action {
  width: 92px;
  height: 40px;
}

.content-skeleton__toolbar {
  gap: 12px;
  margin: 28px 0 20px;
  padding: 16px;
  border: 1px solid #edf1f7;
  border-radius: 12px;
  background: #f8faff;
}

.content-skeleton__toolbar .el-skeleton__item {
  width: 180px;
  height: 36px;
}

.content-skeleton__metrics {
  gap: 12px;
  margin-bottom: 20px;
}

.content-skeleton__metrics .el-skeleton__item {
  flex: 1;
  height: 84px;
  border-radius: 12px;
}

.content-skeleton__table {
  padding: 18px;
  border: 1px solid #e5ebf5;
  border-radius: 12px;
}

.content-skeleton__table-head {
  display: block;
  width: 100%;
  height: 44px;
  margin-bottom: 20px;
}

.content-skeleton__table .el-skeleton__item:not(.content-skeleton__table-head) {
  display: block;
  width: 100%;
  height: 18px;
  margin-bottom: 20px;
}

.content-skeleton__form {
  padding: 22px;
  border: 1px solid #e5ebf5;
  border-radius: 12px;
}

.content-skeleton__form-row {
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid #edf1f7;
}

.content-skeleton__form-row .el-skeleton__item:first-child {
  width: 140px;
}

.content-skeleton__form-row .el-skeleton__item:not(:first-child) {
  flex: 1;
  height: 36px;
}

.content-skeleton__workbench-tabs {
  gap: 10px;
  margin-bottom: 18px;
}

.content-skeleton__workbench-tabs .el-skeleton__item {
  width: 84px;
  height: 36px;
}

.content-skeleton__workbench-grid {
  align-items: stretch;
  gap: 12px;
  min-height: 520px;
}

.content-skeleton__course-list,
.content-skeleton__schedule-grid {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #e5ebf5;
  border-radius: 12px;
}

.content-skeleton__course-list {
  width: 150px;
  grid-template-rows: repeat(7, 58px);
}

.content-skeleton__schedule-grid {
  flex: 1;
  grid-template-columns: repeat(4, minmax(54px, 1fr));
  grid-template-rows: repeat(6, 1fr);
}

.content-skeleton__course-list .el-skeleton__item,
.content-skeleton__schedule-grid .el-skeleton__item {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

@media (max-width: 1100px) {
  .content-skeleton {
    min-height: calc(100vh - 88px);
    padding: 16px;
  }

  .content-skeleton--sidebar {
    grid-template-columns: 180px minmax(0, 1fr);
    padding: 0;
  }

  .content-skeleton__sidebar,
  .content-skeleton__main {
    padding: 18px;
  }

  .content-skeleton__toolbar .el-skeleton__item:nth-child(n + 4) {
    display: none;
  }
}
</style>
