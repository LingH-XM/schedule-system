<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

type PageKey = 'command' | 'workbench' | 'teachers'

const page = ref<PageKey>('command')
const noticeOpen = ref(false)
const running = ref(false)
const progress = ref(72)
const toast = ref('')
const selectedTeacher = ref('林老师')
let timer: ReturnType<typeof setInterval> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

const pages = [
  { key: 'command' as const, label: '调度指挥台', hint: '把复杂进度变成下一步行动' },
  { key: 'workbench' as const, label: '排课工作台', hint: '高密度界面仍然保持秩序' },
  { key: 'teachers' as const, label: '教师负载', hint: '让异常比平均值更先被看到' }
]

const title = computed(() => pages.find((item) => item.key === page.value)?.label ?? '')

const schedule = [
  ['语文', '数学', '英语', '体育', '科学'],
  ['数学', '语文', '美术', '英语', '音乐'],
  ['英语', '科学', '语文', '数学', '体育'],
  ['道德与法治', '数学', '劳动', '语文', '英语']
]

const teachers = [
  { name: '林老师', subject: '语文', hours: 18, target: 18, tone: 'blue' },
  { name: '陈老师', subject: '数学', hours: 20, target: 18, tone: 'amber' },
  { name: '许老师', subject: '英语', hours: 16, target: 18, tone: 'violet' },
  { name: '周老师', subject: '科学', hours: 12, target: 14, tone: 'green' },
  { name: '黄老师', subject: '体育', hours: 18, target: 18, tone: 'coral' }
]

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

function startScheduling() {
  if (running.value) return
  running.value = true
  progress.value = 72
  timer = setInterval(() => {
    progress.value += 4
    if (progress.value >= 100) {
      progress.value = 100
      running.value = false
      if (timer) clearInterval(timer)
      timer = null
      showToast('排课方案已生成，发现 2 处需要确认')
    }
  }, 180)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <main class="showcase">
    <header class="demo-bar">
      <div>
        <span class="demo-mark">S</span>
        <strong>设计工程体验室</strong>
        <span class="demo-caption">排课系统 · 交互概念</span>
      </div>
      <nav class="page-switch" aria-label="体验页面">
        <button
          v-for="item in pages"
          :key="item.key"
          type="button"
          :class="{ active: page === item.key }"
          @click="page = item.key"
        >
          {{ item.label }}
        </button>
        <span class="switch-indicator" :style="{ transform: `translateX(${pages.findIndex((item) => item.key === page) * 100}%)` }" />
      </nav>
      <a class="back-link" href="/dashboard">返回系统</a>
    </header>

    <section class="product-shell">
      <aside class="side-nav">
        <div class="product-brand">
          <span class="brand-glyph">课</span>
          <div><strong>排课系统</strong><small>School OS</small></div>
        </div>
        <div class="school-switcher">
          <span class="school-avatar">翔</span>
          <div><strong>翔东小学</strong><small>主校区</small></div>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </div>
        <nav class="main-nav">
          <button :class="{ active: page === 'command' }" @click="page = 'command'"><span>⌁</span>控制台</button>
          <button><span>□</span>基础数据<small>已同步</small></button>
          <button><span>◇</span>排课规则</button>
          <button :class="{ active: page === 'workbench' }" @click="page = 'workbench'"><span>▦</span>排课管理</button>
          <button :class="{ active: page === 'teachers' }" @click="page = 'teachers'"><span>◌</span>教师课时</button>
          <button><span>▤</span>课表管理</button>
        </nav>
        <div class="side-foot">
          <div class="mini-progress"><span :style="{ width: `${progress}%` }" /></div>
          <strong>本学期准备度 {{ progress }}%</strong>
          <small>{{ running ? '正在生成新方案…' : '最近保存于 09:42' }}</small>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <div class="breadcrumb"><span>2025—2026学年</span><strong>第二学期</strong></div>
          <div class="top-actions">
            <button class="icon-button" aria-label="搜索"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></button>
            <div class="notice-wrap">
              <button class="icon-button" aria-label="通知" @click="noticeOpen = !noticeOpen">
                <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8"/><path d="M10 20h4"/></svg><i />
              </button>
              <Transition name="popover">
                <div v-if="noticeOpen" class="notice-popover">
                  <strong>待处理提醒</strong>
                  <button @click="page = 'workbench'; noticeOpen = false">四年级（2）班有 2 处规则冲突<small>现在处理</small></button>
                  <button @click="page = 'teachers'; noticeOpen = false">许老师距离周课时目标还差 2 节<small>查看负载</small></button>
                </div>
              </Transition>
            </div>
            <span class="top-divider" />
            <button class="profile"><span>教</span><div><strong>教务老师</strong><small>管理员</small></div></button>
          </div>
        </header>

        <Transition name="page" mode="out-in">
          <div :key="page" class="page-content">
            <template v-if="page === 'command'">
              <section class="welcome-row stagger-item">
                <div><h1>早上好，教务老师</h1><p>今天没有紧急冲突，可以从上次保存的位置继续。</p></div>
                <button class="primary-button" :disabled="running" @click="startScheduling">
                  <span>{{ running ? `正在生成 ${progress}%` : '开始智能排课' }}</span>
                  <svg v-if="!running" viewBox="0 0 20 20"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>
                </button>
              </section>

              <section class="readiness stagger-item">
                <div class="readiness-copy"><small>排课准备度</small><strong>{{ progress }}%</strong><p>{{ running ? '正在计算教师、教室与课程约束' : '基础数据与核心规则已就绪' }}</p></div>
                <div class="step-rail">
                  <div class="done"><i>✓</i><strong>基础数据</strong><small>1,284 条已同步</small></div>
                  <span />
                  <div class="done"><i>✓</i><strong>规则配置</strong><small>32 条已启用</small></div>
                  <span />
                  <div :class="{ done: progress === 100 }"><i>{{ progress === 100 ? '✓' : '3' }}</i><strong>生成课表</strong><small>{{ progress === 100 ? '等待确认' : '可以开始' }}</small></div>
                </div>
              </section>

              <div class="dashboard-grid">
                <section class="schedule-preview stagger-item">
                  <header><div><h2>本周课表概览</h2><p>四年级（2）班 · 主校区</p></div><button @click="page = 'workbench'">打开工作台 <span>→</span></button></header>
                  <div class="week-grid">
                    <span class="period-label" />
                    <strong v-for="day in ['周一','周二','周三','周四','周五']" :key="day">{{ day }}</strong>
                    <template v-for="(row, rowIndex) in schedule" :key="rowIndex">
                      <span class="period-label">{{ rowIndex + 1 }}</span>
                      <button v-for="(lesson, colIndex) in row" :key="lesson + colIndex" :class="`lesson tone-${(rowIndex + colIndex) % 5}`">
                        <strong>{{ lesson }}</strong><small>{{ ['林','陈','许','周','黄'][(rowIndex + colIndex) % 5] }}老师</small>
                      </button>
                    </template>
                  </div>
                </section>
                <aside class="task-rail stagger-item">
                  <header><h2>待处理事项</h2><span>3</span></header>
                  <button @click="page = 'workbench'"><i class="warning">!</i><div><strong>2 处规则冲突</strong><small>四年级（2）班 · 刚刚</small></div><span>›</span></button>
                  <button @click="page = 'teachers'"><i class="neutral">↗</i><div><strong>3 位教师负载偏高</strong><small>超过建议值 2 节</small></div><span>›</span></button>
                  <button @click="showToast('已将缺失数据定位到基础数据')"><i class="success">✓</i><div><strong>1 间教室待确认</strong><small>实验室 B · 10 分钟前</small></div><span>›</span></button>
                  <footer>今日已自动解决 <strong>12</strong> 项</footer>
                </aside>
              </div>
            </template>

            <template v-else-if="page === 'workbench'">
              <section class="welcome-row compact stagger-item">
                <div><span class="overline">{{ title }}</span><h1>四年级（2）班</h1><p>拖动课程调整节次；硬性规则会即时阻止冲突。</p></div>
                <div class="button-group"><button class="secondary-button" @click="showToast('已保存当前排课草稿')">保存草稿</button><button class="primary-button" @click="showToast('课表已发布到教师端')">发布课表</button></div>
              </section>
              <section class="workbench-layout stagger-item">
                <aside class="course-pool"><header><h2>待排课程</h2><span>8</span></header><p>按剩余课时排序</p>
                  <button v-for="(course, index) in ['语文 · 4节','数学 · 3节','英语 · 3节','科学 · 2节','体育 · 2节']" :key="course" draggable="true" :class="`pool-${index}`"><i /><div><strong>{{ course.split(' · ')[0] }}</strong><small>{{ course.split(' · ')[1] }} · {{ ['林','陈','许','周','黄'][index] }}老师</small></div><span>⠿</span></button>
                </aside>
                <div class="timetable-board"><header><div><button>‹</button><strong>第 6 周</strong><button>›</button></div><span><i />规则实时校验已开启</span></header>
                  <div class="board-grid">
                    <span /><strong v-for="day in ['周一 03/09','周二 03/10','周三 03/11','周四 03/12','周五 03/13']" :key="day">{{ day }}</strong>
                    <template v-for="(row, rowIndex) in schedule" :key="rowIndex">
                      <span class="board-period"><b>{{ rowIndex + 1 }}</b><small>{{ ['08:20','09:10','10:15','11:05'][rowIndex] }}</small></span>
                      <button v-for="(lesson, colIndex) in row" :key="lesson + colIndex" :class="['board-lesson', `tone-${(rowIndex + colIndex) % 5}`, { conflict: rowIndex === 1 && colIndex === 3 }]" @click="rowIndex === 1 && colIndex === 3 ? showToast('冲突：陈老师此时正在四（1）班授课') : showToast(`${lesson} · 已选中`)">
                        <strong>{{ lesson }}</strong><small>{{ ['林','陈','许','周','黄'][(rowIndex + colIndex) % 5] }}老师</small><i v-if="rowIndex === 1 && colIndex === 3">!</i>
                      </button>
                    </template>
                  </div>
                </div>
              </section>
            </template>

            <template v-else>
              <section class="welcome-row compact stagger-item">
                <div><span class="overline">{{ title }}</span><h1>教师课时分布</h1><p>先处理异常，再查看整体；数据来自当前已发布方案。</p></div>
                <button class="secondary-button" @click="showToast('教师课时明细已导出')">导出明细</button>
              </section>
              <section class="load-summary stagger-item">
                <div><small>纳入统计</small><strong>68 <span>位教师</span></strong></div><div><small>负载健康</small><strong>61 <span>位 · 89.7%</span></strong></div><div class="attention"><small>需要关注</small><strong>7 <span>位教师</span></strong></div><div><small>本周总课时</small><strong>1,126 <span>节</span></strong></div>
              </section>
              <section class="teacher-layout stagger-item">
                <div class="load-chart"><header><div><h2>周课时负载</h2><p>实心柱为已排课时，标记线为目标值</p></div><div class="legend"><span><i />已排</span><span><i />目标</span></div></header>
                  <div class="chart-area">
                    <div v-for="teacher in teachers" :key="teacher.name" class="bar-group" @click="selectedTeacher = teacher.name">
                      <div class="bar-track"><span :class="teacher.tone" :style="{ height: `${teacher.hours * 4.1}%` }"><i :style="{ bottom: `${teacher.target * 4.1}%` }" /></span></div><strong>{{ teacher.name.slice(0,1) }}</strong>
                    </div>
                    <div class="chart-lines"><span v-for="line in 4" :key="line" :style="{ bottom: `${line * 20}%` }" /></div>
                  </div>
                </div>
                <aside class="teacher-detail"><header><span>{{ selectedTeacher.slice(0,1) }}</span><div><h2>{{ selectedTeacher }}</h2><p>{{ teachers.find(t => t.name === selectedTeacher)?.subject }} · 主校区</p></div><button>•••</button></header>
                  <div class="detail-metric"><span><small>已排课时</small><strong>{{ teachers.find(t => t.name === selectedTeacher)?.hours }} 节</strong></span><span><small>目标课时</small><strong>{{ teachers.find(t => t.name === selectedTeacher)?.target }} 节</strong></span></div>
                  <h3>本周分布</h3><div class="day-load"><span v-for="(value,index) in [4,3,5,2,4]" :key="index"><i :style="{ height: `${value * 14}px` }" /><small>{{ ['一','二','三','四','五'][index] }}</small></span></div>
                  <button class="detail-action" @click="showToast(`已打开${selectedTeacher}的完整课表`)">查看完整课表 <span>→</span></button>
                </aside>
              </section>
            </template>
          </div>
        </Transition>
      </div>
    </section>

    <Transition name="toast">
      <div v-if="toast" class="demo-toast"><span>✓</span>{{ toast }}</div>
    </Transition>
  </main>
</template>

<style scoped>
.showcase{--ink:#172033;--muted:#70798b;--line:#e5e8ee;--blue:#2864dc;--ease:cubic-bezier(.23,1,.32,1);min-height:100vh;background:#eef0f4;color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",sans-serif}.showcase button{font:inherit}.demo-bar{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:#fff;border-bottom:1px solid #dfe2e8}.demo-bar>div{display:flex;align-items:center;gap:10px}.demo-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#172033;color:#fff;font-weight:800}.demo-caption{color:#8b93a3;font-size:12px}.page-switch{position:relative;display:grid;grid-template-columns:repeat(3,1fr);padding:4px;border-radius:10px;background:#f0f2f5}.page-switch button{position:relative;z-index:1;width:116px;padding:7px 10px;border:0;background:transparent;color:#71798a;font-size:13px;cursor:pointer;transition:color 160ms ease}.page-switch button.active{color:#172033;font-weight:700}.switch-indicator{position:absolute;top:4px;left:4px;width:116px;height:31px;border-radius:7px;background:#fff;box-shadow:0 1px 4px rgba(28,39,58,.12);transition:transform 260ms var(--ease)}.back-link{padding:8px 12px;border:1px solid #dde1e8;border-radius:8px;font-size:13px;font-weight:600;transition:border-color 160ms ease,transform 140ms var(--ease)}.back-link:active{transform:scale(.97)}.product-shell{display:grid;grid-template-columns:228px 1fr;width:min(1440px,calc(100% - 40px));height:calc(100vh - 96px);min-height:720px;margin:16px auto;background:#fff;border:1px solid #dfe2e8;border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(25,33,47,.10)}.side-nav{display:flex;flex-direction:column;padding:22px 14px;background:#171c26;color:#d8dce4}.product-brand{display:flex;align-items:center;gap:11px;padding:0 8px 20px}.brand-glyph{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#fff;color:#171c26;font-weight:900}.product-brand div,.school-switcher div{display:grid;gap:2px}.product-brand strong{color:#fff;font-size:15px}.product-brand small,.school-switcher small{color:#7f8796;font-size:10px}.school-switcher{display:flex;align-items:center;gap:9px;padding:10px;margin-bottom:22px;border:1px solid #303745;border-radius:10px;background:#202630}.school-switcher strong{font-size:12px}.school-switcher svg{width:14px;margin-left:auto;fill:none;stroke:#8c95a5;stroke-width:1.5}.school-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#2d65d5;color:#fff;font-size:12px;font-weight:700}.main-nav{display:grid;gap:4px}.main-nav button{display:flex;align-items:center;gap:11px;width:100%;padding:10px;border:0;border-radius:8px;background:transparent;color:#9ba3b2;font-size:13px;text-align:left;cursor:pointer;transition:background-color 160ms ease,color 160ms ease,transform 120ms var(--ease)}.main-nav button>span{width:18px;color:#7f8794;font-size:16px;text-align:center}.main-nav button small{margin-left:auto;color:#5f9b77;font-size:9px}.main-nav button:hover,.main-nav button.active{background:#272e39;color:#fff}.main-nav button.active>span{color:#6f9cff}.main-nav button:active{transform:scale(.98)}.side-foot{margin-top:auto;padding:16px 9px 4px;border-top:1px solid #2b313c}.side-foot strong,.side-foot small{display:block}.side-foot strong{margin-top:10px;color:#d9dde5;font-size:11px}.side-foot small{margin-top:4px;color:#707989;font-size:10px}.mini-progress{height:3px;overflow:hidden;border-radius:3px;background:#303743}.mini-progress span{display:block;height:100%;background:#5e8df0;transition:width 220ms var(--ease)}.workspace{min-width:0;background:#fbfbfc}.topbar{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid var(--line);background:#fff}.breadcrumb{display:flex;align-items:center;gap:8px;font-size:12px}.breadcrumb span{color:#8a92a2}.breadcrumb strong{padding-left:8px;border-left:1px solid #e2e5ea}.top-actions{display:flex;align-items:center;gap:5px}.icon-button{position:relative;display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#6e7788;cursor:pointer;transition:background-color 160ms ease,transform 120ms var(--ease)}.icon-button:hover{background:#f1f3f6}.icon-button:active{transform:scale(.94)}.icon-button svg{width:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}.icon-button i{position:absolute;top:7px;right:7px;width:5px;height:5px;border:1.5px solid #fff;border-radius:50%;background:#e04d4d}.notice-wrap{position:relative}.notice-popover{position:absolute;z-index:20;top:42px;right:-34px;width:300px;padding:10px;border:1px solid #e0e3e9;border-radius:12px;background:#fff;box-shadow:0 16px 42px rgba(30,38,52,.15);transform-origin:calc(100% - 50px) top}.notice-popover>strong{display:block;padding:6px 8px 10px;font-size:13px}.notice-popover button{display:grid;width:100%;gap:3px;padding:10px 8px;border:0;border-radius:8px;background:transparent;color:#273044;font-size:12px;text-align:left;cursor:pointer}.notice-popover button:hover{background:#f5f7fa}.notice-popover small{color:#7b8494;font-size:10px}.popover-enter-active,.popover-leave-active{transition:opacity 180ms var(--ease),transform 180ms var(--ease)}.popover-leave-active{transition-duration:130ms}.popover-enter-from,.popover-leave-to{opacity:0;transform:scale(.96) translateY(-4px)}.top-divider{height:24px;margin:0 9px;border-left:1px solid #e3e6eb}.profile{display:flex;align-items:center;gap:8px;padding:3px 4px;border:0;background:transparent;cursor:pointer}.profile>span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#e7ecf7;color:#345689;font-size:12px;font-weight:700}.profile div{display:grid;text-align:left}.profile strong{font-size:11px}.profile small{color:#8a92a1;font-size:9px}.page-content{padding:32px}.page-enter-active,.page-leave-active{transition:opacity 180ms var(--ease),transform 180ms var(--ease),filter 180ms ease}.page-enter-from{opacity:0;transform:translateY(5px);filter:blur(2px)}.page-leave-to{opacity:0;transform:translateY(-3px);filter:blur(2px)}.welcome-row{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px}.welcome-row.compact{align-items:center;margin-bottom:22px}.welcome-row h1{margin:0;font-size:28px;line-height:1.2;letter-spacing:-.6px}.welcome-row p{margin:7px 0 0;color:var(--muted);font-size:12px}.overline{display:block;margin-bottom:5px;color:#2864dc;font-size:10px;font-weight:700}.primary-button,.secondary-button{display:flex;align-items:center;justify-content:center;gap:12px;min-height:40px;padding:0 16px;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;transition:transform 140ms var(--ease),background-color 160ms ease,border-color 160ms ease}.primary-button{border:0;background:#1f5dd1;color:#fff;box-shadow:0 6px 14px rgba(31,93,209,.2)}.primary-button:hover{background:#174eaf}.primary-button:active,.secondary-button:active{transform:scale(.97)}.primary-button:disabled{opacity:.78;cursor:wait}.primary-button svg{width:16px;fill:none;stroke:currentColor;stroke-width:1.6}.secondary-button{border:1px solid #dce0e7;background:#fff;color:#354052}.button-group{display:flex;gap:8px}.readiness{display:grid;grid-template-columns:220px 1fr;align-items:center;padding:22px 24px;margin-bottom:22px;border:1px solid var(--line);border-radius:12px;background:#fff}.readiness-copy{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:2px 8px}.readiness-copy small{grid-column:1/-1;color:#727b8c;font-size:10px}.readiness-copy strong{font-size:31px;letter-spacing:-1px}.readiness-copy p{margin:0;color:#7a8393;font-size:10px}.step-rail{display:grid;grid-template-columns:auto 1fr auto 1fr auto;align-items:center}.step-rail>span{height:1px;margin:0 14px;background:#dfe3e9}.step-rail>div{display:grid;grid-template-columns:24px auto;gap:1px 8px;align-items:center}.step-rail i{grid-row:1/3;display:grid;place-items:center;width:24px;height:24px;border:1px solid #d8dde5;border-radius:50%;color:#9098a7;font-size:10px;font-style:normal}.step-rail strong{font-size:11px}.step-rail small{color:#8a92a1;font-size:9px}.step-rail .done i{border-color:#cfe2d7;background:#eaf5ee;color:#30825a}.dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:18px}.schedule-preview,.task-rail,.workbench-layout,.load-summary,.teacher-layout{border:1px solid var(--line);border-radius:12px;background:#fff}.schedule-preview{padding:20px}.schedule-preview>header,.task-rail>header,.course-pool>header,.timetable-board>header,.load-chart>header{display:flex;align-items:center;justify-content:space-between}.schedule-preview h2,.task-rail h2,.course-pool h2,.load-chart h2{margin:0;font-size:14px}.schedule-preview header p,.load-chart header p{margin:4px 0 0;color:#858d9c;font-size:9px}.schedule-preview header button{border:0;background:transparent;color:#396cc6;font-size:10px;font-weight:700;cursor:pointer}.week-grid{display:grid;grid-template-columns:26px repeat(5,1fr);gap:6px;margin-top:20px}.week-grid>strong{padding-bottom:7px;color:#7f8796;font-size:9px;text-align:center}.period-label{display:grid;place-items:center;color:#a1a7b2;font-size:9px}.lesson{display:grid;gap:2px;min-height:49px;padding:8px;border:1px solid transparent;border-radius:7px;text-align:left;cursor:pointer;transition:transform 140ms var(--ease),border-color 160ms ease}.lesson:hover{border-color:currentColor;transform:translateY(-1px)}.lesson:active{transform:scale(.97)}.lesson strong,.board-lesson strong{font-size:10px}.lesson small,.board-lesson small{opacity:.7;font-size:8px}.tone-0{background:#edf3fe;color:#2e5fae}.tone-1{background:#f4effd;color:#6c51a8}.tone-2{background:#eaf6f0;color:#397a60}.tone-3{background:#fff3e5;color:#9b6530}.tone-4{background:#fdeeed;color:#a95a54}.task-rail{padding:18px}.task-rail header span,.course-pool header span{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#f2f4f7;color:#5f6878;font-size:10px;font-weight:700}.task-rail>button{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:9px;width:100%;padding:14px 0;border:0;border-bottom:1px solid #eef0f3;background:transparent;text-align:left;cursor:pointer;transition:transform 140ms var(--ease)}.task-rail>button:active{transform:scale(.98)}.task-rail>button i{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;font-size:10px;font-style:normal}.task-rail>button div{display:grid;gap:3px}.task-rail>button strong{font-size:10px}.task-rail>button small{color:#8a92a0;font-size:8px}.task-rail>button>span{color:#a0a6b0}.warning{background:#fff1df;color:#c27724}.neutral{background:#edf2fd;color:#406dbf}.success{background:#eaf5ee;color:#3e8b63}.task-rail footer{padding-top:15px;color:#8b92a0;font-size:9px;text-align:center}.task-rail footer strong{color:#3d7758}.workbench-layout{display:grid;grid-template-columns:190px 1fr;min-height:520px;overflow:hidden}.course-pool{padding:18px;border-right:1px solid var(--line)}.course-pool>p{margin:5px 0 14px;color:#8991a0;font-size:9px}.course-pool>button{display:flex;align-items:center;gap:8px;width:100%;padding:10px 8px;margin-bottom:6px;border:1px solid #e7eaf0;border-radius:8px;background:#fff;color:#354052;text-align:left;cursor:grab;transition:border-color 160ms ease,transform 140ms var(--ease),box-shadow 160ms ease}.course-pool>button:hover{border-color:#bdc8da;box-shadow:0 5px 12px rgba(31,43,63,.07);transform:translateY(-1px)}.course-pool>button:active{cursor:grabbing;transform:scale(.98)}.course-pool button i{width:3px;height:30px;border-radius:4px;background:#4778d2}.course-pool button div{display:grid;gap:3px}.course-pool button strong{font-size:10px}.course-pool button small{color:#8b92a0;font-size:8px}.course-pool button>span{margin-left:auto;color:#a2a8b2}.pool-1 i{background:#7c62ba!important}.pool-2 i{background:#459170!important}.pool-3 i{background:#d28a42!important}.pool-4 i{background:#cb6a64!important}.timetable-board{min-width:0;padding:18px}.timetable-board>header>div{display:flex;align-items:center;gap:9px}.timetable-board>header button{width:25px;height:25px;border:1px solid #e2e5ea;border-radius:7px;background:#fff;color:#697283;cursor:pointer}.timetable-board>header strong{font-size:12px}.timetable-board>header>span{display:flex;align-items:center;gap:5px;color:#6a7383;font-size:9px}.timetable-board>header>span i{width:6px;height:6px;border-radius:50%;background:#45a372}.board-grid{display:grid;grid-template-columns:55px repeat(5,1fr);gap:5px;margin-top:18px}.board-grid>strong{padding:7px 2px;color:#757e8e;font-size:8px;text-align:center}.board-period{display:grid;align-content:center}.board-period b{font-size:10px}.board-period small{color:#9ba1ac;font-size:7px}.board-lesson{position:relative;display:grid;gap:3px;min-height:76px;padding:10px;border:1px solid transparent;border-radius:7px;text-align:left;cursor:pointer;transition:transform 140ms var(--ease),border-color 160ms ease}.board-lesson:hover{border-color:currentColor;transform:translateY(-1px)}.board-lesson:active{transform:scale(.98)}.board-lesson.conflict{border-color:#e3a19c;background:#fff1ef}.board-lesson>i{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:14px;height:14px;border-radius:50%;background:#d95950;color:#fff;font-size:8px;font-style:normal}.load-summary{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:18px;overflow:hidden}.load-summary>div{display:grid;gap:5px;padding:18px 22px;border-right:1px solid var(--line)}.load-summary>div:last-child{border:0}.load-summary small{color:#7d8595;font-size:9px}.load-summary strong{font-size:22px;letter-spacing:-.5px}.load-summary strong span{color:#858d9c;font-size:9px;font-weight:500}.load-summary .attention{background:#fffaf3}.load-summary .attention strong{color:#b56c25}.teacher-layout{display:grid;grid-template-columns:1fr 285px;min-height:430px;overflow:hidden}.load-chart{padding:22px}.legend{display:flex;gap:13px;color:#7e8796;font-size:8px}.legend span{display:flex;align-items:center;gap:5px}.legend i{width:8px;height:8px;border-radius:2px;background:#5e83cf}.legend span+span i{height:1px;background:#6c7483}.chart-area{position:relative;z-index:0;display:flex;align-items:flex-end;justify-content:space-around;height:310px;padding:34px 20px 0;margin-top:10px;border-bottom:1px solid #dfe3e9}.chart-lines{position:absolute;z-index:-1;inset:0}.chart-lines span{position:absolute;left:0;width:100%;border-top:1px dashed #ebedf1}.bar-group{display:grid;justify-items:center;align-items:end;width:12%;height:100%;cursor:pointer}.bar-track{display:flex;align-items:end;width:30px;height:230px;border-radius:6px 6px 0 0;background:#f0f2f5}.bar-track>span{position:relative;display:block;width:100%;min-height:8px;border-radius:6px 6px 2px 2px;background:#557fd1;transition:height 420ms var(--ease),filter 160ms ease}.bar-group:hover .bar-track>span{filter:brightness(.94)}.bar-track>span i{position:absolute;left:-7px;width:44px;border-top:2px solid #333d50}.bar-track .amber{background:#d99545}.bar-track .violet{background:#8a70c1}.bar-track .green{background:#55a17d}.bar-track .coral{background:#cc746d}.bar-group>strong{margin-top:10px;color:#687181;font-size:9px}.teacher-detail{padding:22px;border-left:1px solid var(--line);background:#fcfcfd}.teacher-detail>header{display:flex;align-items:center;gap:10px}.teacher-detail>header>span{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#e9eef9;color:#41649f;font-size:13px;font-weight:700}.teacher-detail header div{display:grid;gap:2px}.teacher-detail h2{margin:0;font-size:13px}.teacher-detail header p{margin:0;color:#89919f;font-size:8px}.teacher-detail header button{margin-left:auto;border:0;background:transparent;color:#808897;cursor:pointer}.detail-metric{display:grid;grid-template-columns:1fr 1fr;margin:22px 0;padding:16px 0;border-top:1px solid #e6e9ee;border-bottom:1px solid #e6e9ee}.detail-metric span{display:grid;gap:5px}.detail-metric span+span{padding-left:16px;border-left:1px solid #e3e6eb}.detail-metric small{color:#8b93a2;font-size:8px}.detail-metric strong{font-size:14px}.teacher-detail h3{font-size:10px}.day-load{display:flex;align-items:flex-end;justify-content:space-around;height:110px}.day-load span{display:grid;justify-items:center;align-items:end;height:90px}.day-load i{width:18px;border-radius:4px 4px 2px 2px;background:#dce5f7}.day-load small{margin-top:7px;color:#8b93a1;font-size:8px}.detail-action{display:flex;justify-content:space-between;width:100%;padding:10px 0;margin-top:15px;border:0;border-top:1px solid #e5e8ed;background:transparent;color:#3565b8;font-size:10px;font-weight:700;cursor:pointer}.demo-toast{position:fixed;z-index:50;left:50%;bottom:32px;display:flex;align-items:center;gap:9px;padding:11px 15px;border:1px solid #323945;border-radius:10px;background:#202630;color:#fff;box-shadow:0 14px 36px rgba(24,30,41,.22);font-size:12px;transform:translateX(-50%)}.demo-toast span{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#438b64;font-size:9px}.toast-enter-active,.toast-leave-active{transition:opacity 220ms var(--ease),transform 220ms var(--ease)}.toast-leave-active{transition-duration:150ms}.toast-enter-from,.toast-leave-to{opacity:0;transform:translate(-50%,12px) scale(.97)}.stagger-item{animation:reveal 320ms var(--ease) both}.stagger-item:nth-child(2){animation-delay:45ms}.stagger-item:nth-child(3){animation-delay:90ms}@keyframes reveal{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1100px){.product-shell{width:calc(100% - 20px);grid-template-columns:190px}.side-nav{padding-inline:10px}.page-content{padding:24px}.dashboard-grid,.teacher-layout{grid-template-columns:1fr}.task-rail,.teacher-detail{display:none}.demo-caption{display:none}}
@media(max-width:760px){.demo-bar{height:auto;min-height:64px;gap:10px;padding:10px 14px;flex-wrap:wrap}.demo-bar>div{order:1}.back-link{order:2}.page-switch{order:3;width:100%}.page-switch button,.switch-indicator{width:calc((100vw - 36px)/3)}.product-shell{display:block;height:auto;min-height:calc(100vh - 120px);margin:10px}.side-nav{display:none}.topbar{padding:0 16px}.page-content{padding:20px 16px}.welcome-row{align-items:flex-start;gap:18px}.welcome-row h1{font-size:23px}.readiness{grid-template-columns:1fr;gap:20px}.step-rail{overflow-x:auto}.schedule-preview{overflow-x:auto}.week-grid{min-width:620px}.workbench-layout{grid-template-columns:1fr}.course-pool{display:none}.load-summary{grid-template-columns:1fr 1fr}.teacher-layout{grid-template-columns:1fr}.load-chart{overflow:hidden}.profile div{display:none}}
@media(prefers-reduced-motion:reduce){.showcase *{animation:none!important;transition-duration:.01ms!important}.page-enter-from,.page-leave-to,.popover-enter-from,.popover-leave-to{transform:none!important;filter:none!important}}
</style>
