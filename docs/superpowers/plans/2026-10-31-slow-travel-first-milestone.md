# 慢慢走 · 第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Continue in the current session when implementation is requested; no delegation is needed.

**Goal:** 用一份真实的南京出发计划，制作可在手机上浏览的个人轻手账原型。

**Architecture:** 第一阶段采用静态 HTML、CSS、JavaScript。旅行内容保存在独立 JSON 文件，主题通过 CSS 变量及布局呈现。阶段二再接入持久存储与个人编辑；第一阶段不提供会使用户误以为已持久保存的编辑入口。

**Tech Stack:** 原生 HTML/CSS/JavaScript，JSON，Node.js 内置测试运行器。上线时遵循 Sites 的源码和私密发布流程。

## Global Constraints

- 站名「慢慢走」。
- 南京是计划中的目的地，不计入「已去过的城市」。
- 日期尚未确定，显示「日期待定」。
- 计划与记录分开保存，旅行后编辑记录不会覆盖原计划。
- 旅行内容独立于主题样式。
- 移动端优先，日记不强迫横向翻页。
- 第一阶段的视觉原型不是正式的数据保存工具。
- 不扩大内容的可见范围。

## 工作区状态

2026-10-31 检查：工作目录为空目录，尚未初始化 Git；只有本轮写入的设计与计划文档。开始实施前再次检查目录和上级 AGENTS.md。未经检查不覆盖已有文件。

## Task 1：收集首份内容，建立独立的数据样本

**Files:**
- Create: `slow-travel/dist/content/trips.json`
- Create: `slow-travel/dist/content/schema.mjs`
- Test: `slow-travel/tests/content.test.mjs`

**Interfaces:**
- Consumes: 用户提供的南京地点或攻略、已确认设计。
- Produces: `validateContent(data)`，合法时返回 data，非法时抛出说明错误的 Error；JSON 的固定结构见下。

- [ ] 收集三至五个地点，或一篇已有攻略；仅整理用户提供的意向，不推断已完成的经历。
- [ ] 先写输入验证用例，覆盖计划状态、计划和记录分离，以及重复旅行标识：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../dist/content/schema.mjs';
const trip = { id: 'nanjing-first', city: '南京', status: 'planned', dates: null,
  title: '南京，终于出发', candidates: [], plan: [], journal: [] };
test('a planned trip does not require invented dates or memories', () => {
  assert.equal(validateContent({ version: 1, trips: [trip] }).trips[0].dates, null);
});
test('duplicate trip ids are rejected', () => {
  assert.throws(() => validateContent({ version: 1, trips: [trip, trip] }), /重复/);
});
test('plan and journal must be independent arrays', () => {
  assert.throws(() => validateContent({ version: 1, trips: [{ ...trip, journal: null }] }), /记录/);
});
```

- [ ] 运行 `node --test slow-travel/tests/content.test.mjs`，确认尚未实现验证函数时用例失败。
- [ ] 实现验证器和真实内容样本，再运行同一命令，要求全部通过。

数据结构约定：

```json
{
  "version": 1,
  "profile": { "title": "慢慢走", "intro": "把想去的地方，慢慢变成生活里的故事。" },
  "trips": [{
    "id": "nanjing-first", "city": "南京", "status": "planned", "dates": null,
    "title": "南京，终于出发", "cover": null,
    "candidates": [], "plan": [], "journal": []
  }]
}
```

## Task 2：首页与旅行页

**Files:**
- Create: `slow-travel/dist/index.html`
- Create: `slow-travel/dist/styles.css`
- Create: `slow-travel/dist/app.mjs`
- Create: `slow-travel/README.md`

**Interfaces:**
- Consumes: Task 1 的 JSON；城市入口通过 Trip.city 聚合，同城多次旅行不合并记录。
- Produces: `#/` 首页；`#/trips/nanjing-first` 旅行页；不存在的 ID 显示返回首页入口。

- [ ] 搭建语义化页面壳、站名、导航、加载与失败状态。加载失败显示重试入口，不显示空白成功页。
- [ ] 首页以南京封面为主，配合地图城市入口与等价列表。地图必须使用有可核验来源的边界资源，不能把随手画的形状冒充中国地图；资源不可用时提供清晰的城市列表。
- [ ] 旅行页分别展示出发前计划与旅行记录；没有记录时说明旅行尚未开始，不出现虚构照片、完成统计和感受。
- [ ] 把所有主题颜色、字体与间距集中定义为 CSS 变量。版心、照片和正文在 390px 手机与 1440px 桌面宽度下均可阅读。
- [ ] 所有用户内容用 textContent 或等价转义处理；来源链接仅接受 http/https。
- [ ] 提供键盘焦点、标签、图片说明；支持减少动画设置；页面不依赖悬停操作。
- [ ] README 说明预览启动命令、数据文件位置，以及本阶段不能编辑和持久保存的范围。

## Task 3：验证与交付

**Files:**
- Update: `slow-travel/README.md`
- Update: 本计划的任务状态。

- [ ] 运行内容测试，确认状态与数据不被界面渲染更改。
- [ ] 根据实际环境启动本地预览并检查 HTTP 返回；有浏览器能力时检查桌面、手机截图和键盘浏览。
- [ ] 检查首页 → 南京 → 计划/记录 → 返回首页，以及不存在的旅行地址。
- [ ] 校对展示文案与真实输入，确认不把计划写成经历。
- [ ] 汇报已完成的功能、可打开的预览与验证限制；不把尚未实现的编辑和云端保存描述为可用。

## 后续阶段边界

首个原型确认后，再单独设计持久编辑：保存地点与日记、照片上传、原计划保留、导出备份。正式记录使用服务端持久存储；部署到 Sites 时采用 D1 和 R2。编辑权限与分享权限必须分开验证。多用户开放和可切换主题在本人实际使用之后安排。
