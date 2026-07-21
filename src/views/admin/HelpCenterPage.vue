<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

type GuideItem = {
  id: string
  label: string
  keywords: string
  page: string
}

type GuideGroup = {
  label: string
  items: GuideItem[]
}

const route = useRoute()
const router = useRouter()
const query = ref('')
const activeSection = ref('overview')
let scrollFrame = 0

const guideGroups: GuideGroup[] = [
  {
    label: '开始排课',
    items: [
      { id: 'overview', label: '排课流程总览', keywords: '流程 开始 准备 七步', page: 'start' },
      { id: 'preparation', label: '开始前准备', keywords: '准备 检查 校区 学期 教师', page: 'start' }
    ]
  },
  {
    label: '基础数据',
    items: [
      { id: 'basic-data', label: '完善基础数据', keywords: '校区 学年 学期 教学周期 课程 班级 课时', page: 'data' },
      { id: 'course-arrangement', label: '课程安排', keywords: '课程 课时 年级 班级 零课时', page: 'data' },
      { id: 'teaching-info', label: '教师与任课', keywords: '教师 任课 班主任 周课时 校区', page: 'data' }
    ]
  },
  {
    label: '规则设置',
    items: [
      { id: 'rules', label: '配置排课规则', keywords: '默认规则 课程规则 教师规则 权重 硬约束 软约束', page: 'rules' }
    ]
  },
  {
    label: '生成课表',
    items: [
      { id: 'plans', label: '创建排课方案', keywords: '方案 收藏 复制 删除', page: 'schedule' },
      { id: 'scheduling', label: '智能与手动排课', keywords: '智能排课 拖动 锁定 班级 日志', page: 'schedule' },
      { id: 'publish', label: '检查与生成课表', keywords: '保存 生成 发布 剩余课时', page: 'schedule' }
    ]
  },
  {
    label: '结果管理',
    items: [
      { id: 'results', label: '课表查看与导出', keywords: '班级课表 教师课表 课程课表 学校课表 导出 打印 周次 单双周', page: 'results' },
      { id: 'statistics', label: '教师课时统计', keywords: '教师 周课时 统计 达标 Excel', page: 'results' }
    ]
  },
  {
    label: '问题处理',
    items: [{ id: 'faq', label: '常见问题', keywords: '失败 无解 空白 剩余课程 方案 单双周', page: 'faq' }]
  }
]

const allGuideItems = guideGroups.flatMap((group) => group.items)
const validPages = new Set(allGuideItems.map((item) => item.page))
const currentPage = computed(() => {
  const page = String(route.params.page || 'start')
  return validPages.has(page) ? page : 'start'
})
const currentPageItems = computed(() => allGuideItems.filter((item) => item.page === currentPage.value))

const workflowSteps = [
  { number: 1, label: '基础数据', section: 'basic-data' },
  { number: 2, label: '课程安排', section: 'course-arrangement' },
  { number: 3, label: '任课信息', section: 'teaching-info' },
  { number: 4, label: '规则设置', section: 'rules' },
  { number: 5, label: '创建方案', section: 'plans' },
  { number: 6, label: '智能排课', section: 'scheduling' },
  { number: 7, label: '生成课表', section: 'publish' }
]

const searchResults = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return []
  return allGuideItems.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().includes(keyword)
  )
})

const currentItemIndex = computed(() =>
  Math.max(0, allGuideItems.findIndex((item) => item.id === activeSection.value))
)

const previousItem = computed(() => allGuideItems[currentItemIndex.value - 1] ?? null)
const nextItem = computed(() => allGuideItems[currentItemIndex.value + 1] ?? null)

async function scrollToSection(id: string): Promise<void> {
  const item = allGuideItems.find((guideItem) => guideItem.id === id)
  if (!item) return
  activeSection.value = id
  query.value = ''
  const targetPath = `/help/${item.page}`
  if (route.path !== targetPath || route.hash !== `#${id}`) {
    await router.push({ path: targetPath, hash: `#${id}` })
    await nextTick()
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && searchResults.value[0]) {
    scrollToSection(searchResults.value[0].id)
  }
}

function syncActiveSection(): void {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    const reachedPageBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
    if (reachedPageBottom) {
      activeSection.value = currentPageItems.value.at(-1)?.id ?? 'overview'
      return
    }
    const current = currentPageItems.value
      .map((item) => ({ item, top: document.getElementById(item.id)?.getBoundingClientRect().top ?? Infinity }))
      .filter(({ top }) => top <= 130)
      .at(-1)
    activeSection.value = current?.item.id ?? currentPageItems.value[0]?.id ?? 'overview'
  })
}

onMounted(() => {
  window.addEventListener('scroll', syncActiveSection, { passive: true })
  syncActiveSection()

  const targetId = String(route.hash || '').replace(/^#/, '')
  if (targetId && currentPageItems.value.some((item) => item.id === targetId)) {
    void nextTick(() => scrollToSection(targetId))
  }
})

watch(
  () => [route.params.page, route.hash],
  async () => {
    const targetId = String(route.hash || '').replace(/^#/, '')
    const fallbackId = currentPageItems.value[0]?.id ?? 'overview'
    activeSection.value = currentPageItems.value.some((item) => item.id === targetId) ? targetId : fallbackId
    await nextTick()
    document.getElementById(activeSection.value)?.scrollIntoView({ behavior: 'auto', block: 'start' })
    syncActiveSection()
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncActiveSection)
  cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div class="help-standalone">
    <header class="help-site-header">
      <RouterLink class="help-brand" to="/dashboard">排课系统</RouterLink>
      <span aria-hidden="true"></span>
      <strong>使用说明</strong>
      <div class="help-search">
        <label for="help-search-input">搜索使用说明</label>
        <input
          id="help-search-input"
          v-model="query"
          type="search"
          autocomplete="off"
          placeholder="搜索步骤或问题"
          @keydown="handleSearchKeydown"
        />
        <div v-if="query" class="help-search-results">
          <button
            v-for="item in searchResults"
            :key="item.id"
            type="button"
            @click="scrollToSection(item.id)"
          >
            {{ item.label }}
          </button>
          <p v-if="searchResults.length === 0">没有找到相关内容</p>
        </div>
      </div>
      <RouterLink class="help-back-link" to="/dashboard">返回控制台</RouterLink>
    </header>

    <article class="help-center">
    <div class="help-layout">
      <aside class="help-sidebar" aria-label="使用说明章节">
        <nav>
          <section v-for="group in guideGroups" :key="group.label" class="help-nav-group">
            <h2>{{ group.label }}</h2>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              :class="{ active: activeSection === item.id }"
              @click="scrollToSection(item.id)"
            >
              {{ item.label }}
            </button>
          </section>
        </nav>
      </aside>

      <main class="help-article">
        <section v-if="currentPage === 'start'" id="overview" class="guide-section guide-hero">
          <h1>完成一次排课</h1>
          <p class="guide-lead">
            排课工作的核心顺序是：先保证数据完整，再配置必要规则，最后创建方案并生成课表。
            按照下面七个步骤逐项完成，可以减少数据遗漏和约束冲突。
          </p>

          <div class="workflow" aria-label="完整排课流程">
            <button
              v-for="step in workflowSteps"
              :key="step.number"
              type="button"
              @click="scrollToSection(step.section)"
            >
              <span>{{ step.number }}</span>
              <strong>{{ step.label }}</strong>
            </button>
          </div>

          <div class="guide-note guide-note--plain">
            <strong>建议</strong>
            <p>第一次使用时按顺序完成全部步骤。后续同一学期调整课表，可以从“排课方案”开始。</p>
          </div>
        </section>

        <section v-if="currentPage === 'start'" id="preparation" class="guide-section">
          <h2>开始前准备</h2>
          <p>开始排课前，先确认以下信息已经明确。准备越完整，后续智能排课需要返工的次数越少。</p>
          <ul class="guide-checklist">
            <li>确认本学期使用的校区、学段、年级和班级。</li>
            <li>确认教学周期、每周上课天数和每天课节数量。</li>
            <li>准备课程、教师、班主任和各班任课关系。</li>
            <li>确认各年级、各班每门课程的周课时。</li>
            <li>收集教师不可排时间、连堂课、单双周和合班课要求。</li>
          </ul>
          <div class="guide-warning">
            <strong>不要直接从智能排课开始</strong>
            <p>课程课时或任课教师缺失时，系统无法生成完整的待排课程。</p>
          </div>
        </section>

        <section v-if="currentPage === 'data'" id="basic-data" class="guide-section guide-hero">
          <div class="guide-section-heading">
            <div>
              <span>第一步</span>
              <h2>完善基础数据</h2>
            </div>
            <RouterLink to="/basic-data">前往基础数据</RouterLink>
          </div>
          <p>
            基础数据是排课的底座。建议按左侧菜单从上到下完成，页面右侧的状态圆点可以帮助确认哪些内容已经设置。
          </p>

          <div class="guide-setting-list">
            <div>
              <strong>校区设置</strong>
              <p>维护学校名称、校区名称和学段学制。多校区数据会分别参与排课筛选。</p>
            </div>
            <div>
              <strong>学年学期</strong>
              <p>选择当前学期并填写起止日期，系统会据此计算教学周数和按周课表。</p>
            </div>
            <div>
              <strong>教学周期管理</strong>
              <p>设置上课日期范围、每周上课天数、每日课节和午休等时间结构。</p>
            </div>
            <div>
              <strong>课程管理</strong>
              <p>维护课程名称、简称、所属学科、校区和适用学段。</p>
            </div>
            <div>
              <strong>班级设置与班级课时</strong>
              <p>建立年级班级，并为班级设置可用的教学周期与日课节结构。</p>
            </div>
          </div>

          <div class="guide-note">
            <strong>建议按左侧菜单顺序完成</strong>
            <p>修改学期、班级或教学周期后，再检查一次课程安排和任课信息是否仍然匹配。</p>
          </div>

          <div class="guide-preview" aria-label="基础数据页面示意">
            <div class="guide-preview-top">
              <strong>排课系统</strong>
              <span>基础数据</span>
              <span>规则设置</span>
              <span>排课管理</span>
            </div>
            <div class="guide-preview-body">
              <aside>
                <strong>基础数据</strong>
                <span class="active">校区与学期</span>
                <span>课程与班级</span>
                <span>课程安排</span>
                <span>教师与任课</span>
              </aside>
              <div>
                <div class="guide-preview-actions">
                  <strong>学年学期</strong>
                  <button type="button" disabled>新增学期</button>
                </div>
                <div class="guide-preview-table">
                  <div class="head"><span>学期名称</span><span>开始日期</span><span>结束日期</span><span>状态</span></div>
                  <div><span>2025–2026学年 第二学期</span><span>2026-02-21</span><span>2026-08-14</span><span>当前学期</span></div>
                  <div><span>2025–2026学年 第一学期</span><span>2025-09-01</span><span>2026-01-23</span><span>已结束</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-if="currentPage === 'data'" id="course-arrangement" class="guide-section">
          <div class="guide-section-heading">
            <div>
              <span>第二步</span>
              <h2>设置课程安排</h2>
            </div>
            <RouterLink to="/basic-data">前往课程安排</RouterLink>
          </div>
          <p>
            在“基础数据 → 课程安排”中，选择校区和年级，填写每个班级每门课程的周课时。这里的数据会直接生成排课工作台左侧的待安排课程。
          </p>
          <ol class="guide-steps">
            <li><span>1</span><div><strong>选择范围</strong><p>选择校区、年级，并确认当前班级数量正确。</p></div></li>
            <li><span>2</span><div><strong>填写周课时</strong><p>可以先使用批量设置，再根据班级差异单独调整。</p></div></li>
            <li><span>3</span><div><strong>删除零课时学科</strong><p>确认本年级不使用的课程后，删除零课时学科，避免重启后重新出现。</p></div></li>
            <li><span>4</span><div><strong>保存课程安排</strong><p>保存后检查总课时是否符合每天课节和每周天数。</p></div></li>
          </ol>
          <div class="guide-note guide-note--plain">
            <strong>Excel 操作</strong>
            <p>课程较多时，可使用“模板下载 → 填写数据 → 数据导入”；修改前可以先“数据导出”留存备份。</p>
          </div>
        </section>

        <section v-if="currentPage === 'data'" id="teaching-info" class="guide-section">
          <div class="guide-section-heading">
            <div>
              <span>第三步</span>
              <h2>录入教师与任课信息</h2>
            </div>
            <RouterLink to="/basic-data">前往任课信息</RouterLink>
          </div>
          <p>教师和课程必须正确对应，否则系统无法检查教师冲突，也不能统计教师课时。</p>
          <div class="guide-setting-list">
            <div>
              <strong>录入教师</strong>
              <p>至少填写教师姓名、周课时要求和校区。周课时要求用于生成后的教师课时统计。</p>
            </div>
            <div>
              <strong>设置班主任</strong>
              <p>在任课信息表格的班主任列为每个班级选择班主任。</p>
            </div>
            <div>
              <strong>分配任课教师</strong>
              <p>按年级和班级为各课程选择教师，可单格修改，也可进入“在线编辑”批量处理。</p>
            </div>
            <div>
              <strong>保存任课</strong>
              <p>完成后点击表格下方“保存任课”，确保修改写入当前学期。</p>
            </div>
          </div>
          <div class="guide-warning">
            <strong>同一位教师姓名应保持一致</strong>
            <p>不要用简称或重复创建同名教师，否则可能造成课时统计分散或教师冲突识别不准确。</p>
          </div>
        </section>

        <section v-if="currentPage === 'rules'" id="rules" class="guide-section guide-hero">
          <div class="guide-section-heading">
            <div>
              <span>第四步</span>
              <h2>配置排课规则</h2>
            </div>
            <RouterLink to="/rule-settings">前往规则设置</RouterLink>
          </div>
          <p>只设置学校真正需要的规则。规则越多、约束越严格，求解难度越高。</p>
          <div class="guide-rule-table">
            <div class="head"><span>规则类别</span><span>适合设置的内容</span><span>建议</span></div>
            <div><strong>默认规则</strong><span>教案齐头、课程分散、上下节连续等通用行为</span><span>先使用推荐默认值</span></div>
            <div><strong>课程规则</strong><span>连堂课、合班课、单双周、课程时段、主副科</span><span>按课程实际需求设置</span></div>
            <div><strong>教师规则</strong><span>教师不可排时间、每日最大课时、教师互斥</span><span>优先录入明确限制</span></div>
            <div><strong>权重分配</strong><span>教师周分布、日分布、连堂偏好、主副科平衡</span><span>保持自动归一化为 100</span></div>
          </div>
          <div class="guide-warning">
            <strong>硬约束必须满足</strong>
            <p>把偏好全部设成硬约束，容易导致无解。只有绝对不能违反的要求才设置为硬约束，其余交给权重优化。</p>
          </div>
        </section>

        <section v-if="currentPage === 'schedule'" id="plans" class="guide-section guide-hero">
          <div class="guide-section-heading">
            <div>
              <span>第五步</span>
              <h2>创建排课方案</h2>
            </div>
            <RouterLink to="/schedules">前往排课管理</RouterLink>
          </div>
          <p>排课方案用于保存不同试排结果。可以为同一学期创建多个方案进行比较。</p>
          <ol class="guide-steps">
            <li><span>1</span><div><strong>检查必填数据</strong><p>方案卡片会提示尚未设置的基础数据，全部完成后才能进入完整排课。</p></div></li>
            <li><span>2</span><div><strong>创建并命名</strong><p>使用能区分用途的名称，例如“正式方案”“第一次试排”。</p></div></li>
            <li><span>3</span><div><strong>进入调整课表</strong><p>点击方案卡片中的“调整课表”，进入排课工作台。</p></div></li>
          </ol>
          <div class="guide-note guide-note--plain">
            <strong>方案管理说明</strong>
            <p>收藏方案会排在前面；复制方案会连同排课结果一起复制，但副本不会自动发布；删除方案会同时删除关联课表数据。</p>
          </div>
        </section>

        <section v-if="currentPage === 'schedule'" id="scheduling" class="guide-section">
          <div class="guide-section-heading">
            <div>
              <span>第六步</span>
              <h2>智能排课与手动调整</h2>
            </div>
            <RouterLink to="/schedules">选择方案进入工作台</RouterLink>
          </div>
          <p>工作台左侧是待安排课程，中间是当前班级课表，右侧用于观察教师同一时间的课程占用情况。</p>

          <h3>推荐操作顺序</h3>
          <ol class="guide-steps">
            <li><span>1</span><div><strong>选择校区和年级</strong><p>智能排课按当前年级执行，先确认班级标签和待安排课程正确。</p></div></li>
            <li><span>2</span><div><strong>先安排固定内容</strong><p>手动放置必须固定的课程，并锁定课程、班级或全年级。</p></div></li>
            <li><span>3</span><div><strong>执行智能排课</strong><p>点击“智能排课”，等待求解完成；已有未锁定课程会在确认后重新安排。</p></div></li>
            <li><span>4</span><div><strong>查看剩余课程</strong><p>左侧数字应逐步归零。仍有剩余时，检查冲突规则或手动补排。</p></div></li>
            <li><span>5</span><div><strong>手动微调并锁定</strong><p>拖动课程调整节次，确认后锁定满意的结果，避免再次求解时改变。</p></div></li>
          </ol>

          <div class="guide-note">
            <strong>锁定状态的作用</strong>
            <p>锁定课程不会被智能排课移动。锁定班级会保护该班所有已排课程；全年级锁定适合方案已经确定后统一保护。</p>
          </div>
          <div class="guide-warning">
            <strong>智能排课失败时先看日志</strong>
            <p>“查看排课日志”会提示教师冲突、连堂课冲突、课程关系冲突或约束无解。先调整对应规则，再重新排课。</p>
          </div>
        </section>

        <section v-if="currentPage === 'schedule'" id="publish" class="guide-section">
          <div class="guide-section-heading">
            <div>
              <span>第七步</span>
              <h2>检查并生成课表</h2>
            </div>
            <RouterLink to="/schedules">返回排课方案</RouterLink>
          </div>
          <p>完成所有年级排课后，先保存工作结果，再生成供课表管理使用的正式课表。</p>

          <div class="guide-compare">
            <div>
              <strong>保存课表</strong>
              <p>保存当前方案的工作台结果，方便稍后继续调整。</p>
              <span>不会更新课表管理中的已发布版本</span>
            </div>
            <div>
              <strong>生成课表</strong>
              <p>将当前方案发布为最新课表，供班级、教师、课程和学校课表查看。</p>
              <span>课表管理只展示该方案最新发布的结果</span>
            </div>
          </div>

          <ul class="guide-checklist">
            <li>每个班级左侧待安排课程数量均为 0。</li>
            <li>关键固定课程和确认过的班级已经锁定。</li>
            <li>教师课表没有同一教师同一节次重复上课。</li>
            <li>单双周、连堂课、合班课和固定点符合要求。</li>
            <li>保存课表后，再点击“生成课表”完成发布。</li>
          </ul>
        </section>

        <section v-if="currentPage === 'results'" id="results" class="guide-section guide-hero">
          <div class="guide-section-heading">
            <div>
              <span>结果管理</span>
              <h2>查看、筛选与导出课表</h2>
            </div>
            <RouterLink to="/timetable-management">前往课表管理</RouterLink>
          </div>
          <p>在课表管理中先选择已发布的方案，再按校区、年级、班级或教师筛选。</p>
          <div class="guide-setting-list">
            <div><strong>班级课表</strong><p>查看单个班级的完整周课表，可按具体教学周显示单双周课程。</p></div>
            <div><strong>教师课表</strong><p>按教师查看个人课程安排，用于检查冲突和工作量。</p></div>
            <div><strong>课程课表</strong><p>按课程查看该课程在各班级的分布。</p></div>
            <div><strong>学校课表</strong><p>按年级和班级汇总展示，适合学校整体检查和打印。</p></div>
          </div>
          <div class="guide-note guide-note--plain">
            <strong>单双周查看</strong>
            <p>选择“全学期”时显示课程的单双周标记；选择具体周次后，系统按该周是单周或双周显示对应课程。</p>
          </div>
          <p>点击“导出课表”可生成 Excel；打印前可根据需要勾选校区、学年学期、教师、课节时间等显示字段。</p>
        </section>

        <section v-if="currentPage === 'results'" id="statistics" class="guide-section">
          <div class="guide-section-heading">
            <div>
              <span>结果管理</span>
              <h2>检查教师课时</h2>
            </div>
            <RouterLink to="/teacher-hours-statistics">前往教师课时统计</RouterLink>
          </div>
          <p>教师课时统计读取已生成课表，比较教师实际已排课时和录入教师时设置的周课时要求。</p>
          <ul class="guide-checklist">
            <li>选择需要统计的已发布课表方案。</li>
            <li>按校区、完成状态或教师姓名筛选。</li>
            <li>查看已排课时、课时差额、完成率和达标状态。</li>
            <li>需要留档时点击“数据导出”生成 Excel。</li>
          </ul>
        </section>

        <section v-if="currentPage === 'faq'" id="faq" class="guide-section guide-hero">
          <h2>常见问题</h2>
          <div class="guide-faq">
            <details open>
              <summary>进入排课方案后提示基础数据未设置</summary>
              <p>根据方案卡片提示返回基础数据，重点检查校区、学期、课程安排和任课信息。保存后重新进入方案。</p>
            </details>
            <details>
              <summary>智能排课失败或提示模型无解</summary>
              <p>先查看排课日志定位冲突。优先检查教师不可排时间、连堂课、合班课和过多硬约束；适当放宽偏好后重新求解。</p>
            </details>
            <details>
              <summary>智能排课结束后仍有剩余课程</summary>
              <p>检查课程是否缺少任课教师、允许排课时段是否太少，以及教师是否在相同节次已被其他班级占用。可以调整规则后重排或手动补排。</p>
            </details>
            <details>
              <summary>修改后课表管理仍显示旧内容</summary>
              <p>“保存课表”只保存工作台结果。确认调整完成后，还需要点击“生成课表”发布最新版本。</p>
            </details>
            <details>
              <summary>单双周课程没有按周变化</summary>
              <p>确认课程规则中已设置单双周配对，并在课表管理选择具体教学周。具体周次由当前学期教学周期计算。</p>
            </details>
            <details>
              <summary>复制方案后为什么不是已发布状态</summary>
              <p>复制会保留排课结果用于继续调整，但副本默认未发布。检查完成后，在副本工作台重新生成课表。</p>
            </details>
          </div>
        </section>

        <footer class="guide-pager">
          <button v-if="previousItem" type="button" @click="scrollToSection(previousItem.id)">
            <span>上一篇</span>
            <strong>{{ previousItem.label }}</strong>
          </button>
          <span v-else />
          <button v-if="nextItem" type="button" class="next" @click="scrollToSection(nextItem.id)">
            <span>下一篇</span>
            <strong>{{ nextItem.label }}</strong>
          </button>
        </footer>
      </main>

      <aside class="help-outline" aria-label="本页目录">
        <strong>本页目录</strong>
        <button
          v-for="item in currentPageItems"
          :key="item.id"
          type="button"
          :class="{ active: activeSection === item.id }"
          @click="scrollToSection(item.id)"
        >
          {{ item.label }}
        </button>
      </aside>
    </div>
    </article>
  </div>
</template>

<style scoped>
.help-standalone {
  min-height: 100vh;
  background: #fff;
}

.help-site-header {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 64px;
  padding: 0 clamp(20px, 3vw, 44px);
  border-bottom: 1px solid #e5e9f0;
  background: #fff;
  color: #172642;
}

.help-brand {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.help-site-header > span {
  width: 1px;
  height: 22px;
  background: #dfe4eb;
}

.help-site-header > strong {
  font-size: 16px;
}

.help-site-header .help-search {
  margin-left: auto;
}

.help-back-link {
  margin-left: 2px;
  color: #596579;
  font-size: 14px;
}

.help-back-link:hover {
  color: var(--primary);
}

.help-center {
  --guide-text: #24324a;
  --guide-body: #465773;
  --guide-muted: #5f6f8a;
  --guide-line: #d9e2f0;
  --guide-soft: #f4f7fb;
  --guide-blue: #3f6fbf;
  min-height: calc(100vh - 64px);
  overflow: visible;
  background: #fff;
  color: var(--guide-text);
}

.help-center button:not(.el-button) {
  margin-top: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: inherit !important;
}

.help-search {
  position: relative;
  width: min(340px, 36vw);
}

.help-search label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

.help-search input {
  width: 100%;
  height: 40px;
  padding: 0 14px;
  border: 1px solid #dfe3ea;
  border-radius: 7px;
  outline: none;
  background: #fff;
  color: var(--guide-text);
  font: inherit;
}

.help-search input:focus {
  border-color: #9bc8ff;
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.1);
}

.help-search-results {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  z-index: 20;
  padding: 6px;
  border: 1px solid var(--guide-line);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 34px rgba(33, 48, 75, 0.12);
}

.help-search-results button {
  width: 100%;
  padding: 10px 12px !important;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--guide-text);
  text-align: left;
  cursor: pointer;
}

.help-search-results button:hover {
  background: var(--guide-soft) !important;
}

.help-search-results p {
  margin: 0;
  padding: 12px;
  color: var(--guide-muted);
  font-size: 14px;
}

.help-layout {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 210px;
  min-width: 0;
}

.help-sidebar {
  border-right: 1px solid var(--guide-line);
  background: #fbfbfc;
}

.help-sidebar nav {
  position: sticky;
  top: 88px;
  max-height: calc(100vh - 108px);
  padding: 28px 20px 34px;
  overflow-y: auto;
}

.help-nav-group + .help-nav-group {
  margin-top: 22px;
}

.help-nav-group h2 {
  margin: 0 0 8px;
  padding: 0 12px;
  color: #28364d;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}

.help-nav-group button,
.help-outline button {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: #596579;
  text-align: left;
  cursor: pointer;
}

.help-center .help-nav-group button:not(.el-button) {
  position: relative;
  min-height: 34px;
  padding: 6px 12px 6px 24px !important;
  font-size: 14px;
  line-height: 1.6;
}

.help-nav-group button::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 10px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  content: '';
}

.help-nav-group button:hover,
.help-nav-group button.active,
.help-outline button:hover,
.help-outline button.active {
  color: var(--guide-blue) !important;
}

.help-nav-group button:hover {
  background: #f4f7fb !important;
}

.help-nav-group button.active::before {
  background: var(--guide-blue);
}

.help-article {
  min-width: 0;
  max-width: 900px;
  margin: 0 auto;
  padding: 36px clamp(28px, 4vw, 58px) 54px;
}

.guide-section {
  scroll-margin-top: 98px;
  padding: 16px 0 42px;
  border-bottom: 1px solid var(--guide-line);
}

.guide-section + .guide-section {
  padding-top: 42px;
}

.guide-hero {
  padding-top: 0;
}

.guide-section h1 {
  margin: 0 0 12px;
  color: var(--guide-text);
  font-size: clamp(32px, 3vw, 42px);
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.guide-section h2 {
  margin: 0 0 14px;
  color: var(--guide-text);
  font-size: clamp(24px, 2vw, 29px);
  line-height: 1.35;
}

.guide-section h3 {
  margin: 28px 0 12px;
  font-size: 19px;
}

.guide-section > p,
.guide-lead {
  margin: 0 0 20px;
  color: var(--guide-body);
  font-size: 16px;
  line-height: 1.9;
}

.guide-lead {
  max-width: 760px;
  font-size: 17px;
}

.workflow {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  margin: 32px 0 34px;
}

.workflow::before {
  position: absolute;
  top: 17px;
  right: 6%;
  left: 6%;
  height: 1px;
  border-top: 1px dashed #cad2de;
  content: '';
}

.workflow button {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--guide-text);
  cursor: pointer;
}

.workflow button span {
  display: grid;
  width: 34px;
  height: 34px;
  border: 1px solid #8fc0f7;
  border-radius: 50%;
  place-items: center;
  background: #fff;
  color: #2e78c7;
  font-size: 14px;
}

.workflow button strong {
  font-size: 13px;
  white-space: nowrap;
}

.guide-note,
.guide-warning {
  margin: 24px 0;
  padding: 15px 18px;
  border-left: 3px solid #83bafa;
  background: #f7fbff;
}

.guide-note--plain {
  border-left-color: #c5ccd6;
  background: var(--guide-soft);
}

.guide-warning {
  border-left-color: #e2a55b;
  background: #fffaf3;
}

.guide-note strong,
.guide-warning strong {
  display: block;
  margin-bottom: 5px;
  font-size: 15px;
}

.guide-note p,
.guide-warning p {
  margin: 0;
  color: var(--guide-body);
  font-size: 14px;
  line-height: 1.7;
}

.guide-checklist {
  display: grid;
  gap: 11px;
  margin: 18px 0;
  padding: 0;
  list-style: none;
}

.guide-checklist li {
  position: relative;
  padding-left: 25px;
  color: var(--guide-body);
  line-height: 1.65;
}

.guide-checklist li::before {
  position: absolute;
  left: 1px;
  color: var(--guide-blue);
  content: '✓';
}

.guide-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}

.guide-section-heading > div > span {
  display: block;
  margin-bottom: 5px;
  color: var(--guide-muted);
  font-size: 13px;
}

.guide-section-heading h2 {
  margin: 0;
}

.guide-section-heading > a {
  flex: 0 0 auto;
  margin-top: 22px;
  color: #2f80d5;
  font-size: 14px;
}

.guide-setting-list {
  margin: 18px 0 24px;
  border-top: 1px solid var(--guide-line);
}

.guide-setting-list > div {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 18px;
  padding: 17px 0;
  border-bottom: 1px solid var(--guide-line);
}

.guide-setting-list strong {
  font-size: 15px;
}

.guide-setting-list p {
  margin: 0;
  color: var(--guide-body);
  font-size: 14px;
  line-height: 1.7;
}

.guide-preview {
  margin: 26px 0 4px;
  overflow: hidden;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(29, 43, 67, 0.06);
  pointer-events: none;
}

.guide-preview-top {
  display: flex;
  align-items: center;
  gap: 28px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--guide-line);
  color: #6c778a;
  font-size: 11px;
}

.guide-preview-top strong {
  margin-right: 16px;
  color: var(--guide-text);
}

.guide-preview-body {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  min-height: 220px;
}

.guide-preview-body aside {
  display: grid;
  align-content: start;
  gap: 5px;
  padding: 15px 10px;
  border-right: 1px solid var(--guide-line);
  background: #fafbfc;
  font-size: 11px;
}

.guide-preview-body aside strong,
.guide-preview-body aside span {
  padding: 7px 9px;
}

.guide-preview-body aside .active {
  border-left: 2px solid var(--guide-blue);
  background: #f0f6fd;
  color: #2f80d5;
}

.guide-preview-body > div {
  min-width: 0;
  padding: 16px;
}

.guide-preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.guide-preview-actions button {
  padding: 6px 11px !important;
  border: 0;
  border-radius: 4px;
  background: var(--guide-blue) !important;
  color: #fff !important;
  font-size: 10px;
}

.guide-preview-table {
  border: 1px solid var(--guide-line);
  font-size: 10px;
}

.guide-preview-table > div {
  display: grid;
  grid-template-columns: 1.7fr 1fr 1fr 0.8fr;
}

.guide-preview-table span {
  padding: 9px;
  border-right: 1px solid var(--guide-line);
  border-bottom: 1px solid var(--guide-line);
}

.guide-preview-table .head {
  background: #f7f8fa;
  color: #5f6b7e;
  font-weight: 700;
}

.guide-steps {
  display: grid;
  gap: 0;
  margin: 20px 0;
  padding: 0;
  list-style: none;
}

.guide-steps li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 14px;
  padding: 15px 0;
  border-bottom: 1px solid var(--guide-line);
}

.guide-steps li > span {
  display: grid;
  width: 28px;
  height: 28px;
  border: 1px solid #b7c0ce;
  border-radius: 50%;
  place-items: center;
  color: #5d6b80;
  font-size: 13px;
}

.guide-steps strong {
  display: block;
  margin-bottom: 4px;
  font-size: 15px;
}

.guide-steps p {
  margin: 0;
  color: var(--guide-body);
  font-size: 14px;
  line-height: 1.65;
}

.guide-rule-table {
  margin: 22px 0;
  border-top: 1px solid var(--guide-line);
}

.guide-rule-table > div {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 170px;
  border-bottom: 1px solid var(--guide-line);
}

.guide-rule-table span,
.guide-rule-table strong {
  padding: 14px 12px;
  color: var(--guide-body);
  font-size: 14px;
  line-height: 1.55;
}

.guide-rule-table strong {
  color: var(--guide-text);
}

.guide-rule-table .head {
  background: var(--guide-soft);
  font-weight: 700;
}

.guide-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 26px;
  margin: 24px 0;
}

.guide-compare > div {
  padding: 2px 0 18px;
  border-bottom: 2px solid #d6dce6;
}

.guide-compare strong {
  font-size: 18px;
}

.guide-compare p {
  min-height: 48px;
  margin: 10px 0;
  color: var(--guide-body);
  line-height: 1.6;
}

.guide-compare span {
  color: var(--guide-muted);
  font-size: 13px;
}

.guide-faq {
  border-top: 1px solid var(--guide-line);
}

.guide-faq details {
  border-bottom: 1px solid var(--guide-line);
}

.guide-faq summary {
  padding: 18px 2px;
  color: var(--guide-text);
  font-weight: 600;
  cursor: pointer;
}

.guide-faq p {
  margin: -4px 0 18px;
  padding-right: 30px;
  color: var(--guide-body);
  line-height: 1.75;
}

.guide-pager {
  display: flex;
  justify-content: space-between;
  gap: 30px;
  padding-top: 30px;
}

.guide-pager button {
  display: grid;
  gap: 4px;
  padding: 0 !important;
  border: 0;
  background: transparent;
  color: #2f80d5 !important;
  text-align: left;
  cursor: pointer;
}

.guide-pager button.next {
  text-align: right;
}

.guide-pager span {
  color: var(--guide-muted);
  font-size: 12px;
}

.help-outline {
  position: sticky;
  top: 88px;
  align-self: start;
  max-height: calc(100vh - 108px);
  padding: 28px 24px 32px;
  overflow-y: auto;
  border-left: 1px solid var(--guide-line);
}

.help-outline > strong {
  display: block;
  margin-bottom: 14px;
  color: #2b374a;
  font-size: 14px;
  line-height: 1.7;
}

.help-center .help-outline button:not(.el-button) {
  min-height: 32px;
  padding: 5px 4px 5px 16px !important;
  border-left: 1px solid #d9dee7 !important;
  color: #596579 !important;
  font-size: 13px;
  line-height: 1.65;
}

.help-outline button.active {
  border-left: 2px solid var(--guide-blue) !important;
  color: var(--guide-blue) !important;
  font-weight: 600;
}

@media (max-width: 1180px) {
  .help-layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .help-outline {
    display: none;
  }
}

@media (max-width: 820px) {
  .help-site-header {
    flex-wrap: wrap;
    height: auto;
    min-height: 64px;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .help-site-header .help-search {
    order: 3;
    width: 100%;
  }

  .help-layout {
    display: block;
  }

  .help-sidebar {
    position: sticky;
    top: 0;
    z-index: 10;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--guide-line);
    background: rgba(255, 255, 255, 0.97);
  }

  .help-sidebar nav {
    position: static;
    display: flex;
    max-height: none;
    padding: 9px 12px;
    overflow: visible;
  }

  .help-nav-group {
    display: flex;
    flex: 0 0 auto;
    margin: 0 !important;
  }

  .help-nav-group h2 {
    display: none;
  }

  .help-nav-group button {
    flex: 0 0 auto;
    width: auto;
    padding: 9px 11px;
    white-space: nowrap;
  }

  .help-nav-group button::before {
    top: auto;
    right: 10px;
    bottom: 2px;
    left: 10px;
    width: auto;
    height: 2px;
  }

  .help-article {
    padding: 30px 22px 44px;
  }
}

@media (max-width: 600px) {
  .help-site-header {
    gap: 12px;
  }

  .help-site-header > strong,
  .help-site-header > span {
    display: none;
  }

  .help-site-header .help-search {
    width: min(240px, 48vw);
  }

  .help-center {
    border: 0;
    border-radius: 0;
  }

  .help-article {
    padding: 26px 16px 40px;
  }

  .workflow {
    grid-template-columns: repeat(4, 1fr);
    row-gap: 20px;
  }

  .workflow::before {
    display: none;
  }

  .guide-section-heading {
    flex-direction: column;
    gap: 8px;
  }

  .guide-section-heading > a {
    margin-top: 0;
  }

  .guide-setting-list > div,
  .guide-rule-table > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .guide-rule-table .head {
    display: none;
  }

  .guide-rule-table span,
  .guide-rule-table strong {
    padding: 4px 0;
  }

  .guide-rule-table > div:not(.head) {
    padding: 14px 0;
  }

  .guide-compare {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .guide-preview {
    overflow-x: auto;
  }

  .guide-preview > * {
    min-width: 620px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(html) {
    scroll-behavior: auto;
  }
}
</style>
