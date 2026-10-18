你是一个前端游戏开发助手。我正在做一个网页小游戏网站，面向英语用户，通过广告变现。现在要开发第三个游戏：答题测试类（Personality Quiz）。

请严格按照以下要求执行，每完成一个阶段向我汇报，等我确认后再继续下一阶段。

========================================
项目背景
========================================
- 目标：网页小游戏，广告变现
- 目标用户：英语用户（美/欧/英）
- 本次游戏：Personality Quiz（人格测试）
- 技术栈：纯前端，HTML + CSS + 原生 JS，不需要游戏引擎
- 部署：GitHub Pages
- 复用已有模块（必须先读一遍这些文件，保持风格一致）：
  - games/shared/ads.js        （showInterstitial / showRewarded + 频率控制）
  - games/shared/analytics.js  （trackEvent 埋点）
  - games/shared/sound.js      （Web Audio 合成音效，含静音设置）
  - games/shared/style.css     （公共样式、安全区适配、禁选中）
- 重要：所有面向用户的文案必须是英文，口语化、有趣，符合英语母语者习惯
- 代码注释用英文
- 不要用 npm / webpack / 构建工具，所有外部依赖用 CDN
- 移动端优先，竖屏

========================================
阶段 1：项目结构
========================================
1. 新建目录和文件：
   games/quiz/
   ├── index.html
   ├── quiz.js
   └── data.js        # 题目和结果数据

2. 修改 games/index.html：
   - 在已有的游戏卡片列表里新增一张卡片（放在「二打一」之后）
   - 标题："Personality Quiz"
   - 描述："Answer 10 questions to discover your gaming personality."
   - 卡片样式、hover/点击反馈、尺寸必须和已有卡片完全一致，复用同一套 class

3. data.js 要求：
   - 导出一个 quizData 对象，包含：
     - title：测试标题
     - subtitle：一句简介
     - questions：10 道题，每题 4 个选项
     - results：4 种结果，每种包含 id、title、description（2~3 句）、emoji、color、traits（4 个维度的名字）
     - fullReport：每种结果额外 3 段「完整报告」文案（激励视频解锁后展示）
   - 主题："What Kind of Gamer Are You?"
   - 4 种结果：The Strategist / The Explorer / The Competitor / The Casual
   - 每个选项用一个字段标记它属于哪个结果（用于计分）
   - 文案要求：口语化、有网感、不端着，像 BuzzFeed 那种风格
   - 数据要轻量，不要塞长文章

4. 埋点（复用 analytics.js）：
   - quiz_start
   - quiz_answer（参数 question_index）
   - quiz_complete（参数 result_type）
   - share_clicked（参数 platform）
   - rewarded_unlocked
   - ad_shown / ad_clicked（由 ads.js 统一上报，不用重复写）

完成后向我汇报：目录结构、data.js 的完整数据结构（贴一段示例）、首页卡片改动。

========================================
阶段 2：答题流程
========================================
实现答题核心流程。单页应用，用 JS 切换视图，不要页面跳转。

三个视图：

【开始页】
- 大标题（来自 data.title）
- 一句简介（data.subtitle）
- "Start Quiz" 大按钮
- 底部横幅广告位
- 如果 localStorage 里有上次结果，显示一行："Last time you got: The Strategist. Retake?"
  并给一个 "Retake Quiz" 按钮

【答题页】
- 顶部：进度条 + "Question 3 of 10"
- 中间：题目文字（支持换行，字号自适应）
- 4 个选项按钮，纵向排列，支持长文本换行
- 底部：一个小的 "Quit" 文字按钮（点了回开始页，不记录进度）

交互：
- 点击选项 → 按钮高亮 → 0.3 秒后自动进入下一题
- 0.3 秒内有选中动画（背景色过渡 + 轻微缩放）
- 不能回退
- 进度条平滑过渡（transition，不要跳变）
- 最后一题答完 → 计算得分 → 进入结果页

计分：
- 统计 4 种结果被选中的次数
- 取最高分的结果
- 平局时取"最先达到最高分"的那个结果（即按题目顺序，谁先累计到最高分就是谁）

埋点：
- 进入答题页 quiz_start
- 每次选择 quiz_answer（带 question_index）
- 进入结果页 quiz_complete（带 result_type）

状态管理：
- 用一个 state 对象存：当前视图、当前题号、累计得分
- 不要污染全局变量，用 IIFE 或模块模式包裹

完成后告诉我：视图切换的实现方式、计分逻辑代码位置。

========================================
阶段 3：结果页与分享（核心）
========================================
结果页是整个游戏最重要的部分，要好看、好分享。

【结果页内容，从上到下】
1. 结果对应的 emoji（大号，带一个弹入动画）
2. 结果标题："You are The Strategist"
3. 描述段落（data.results[].description）
4. 属性条：4 个维度，每个显示名字 + 百分比条（用动画从 0 涨到实际值）
   - 百分比计算：该结果被选中的次数 / 总题数，再做归一化让四条加起来有视觉差异
5. 分享按钮区（见下）
6. "Unlock Full Report" 按钮（激励视频，阶段 4 实现，先占位）
7. "Retake Quiz" 按钮

【分享功能】
1. 用 Canvas 生成一张分享图（1200×630）：
   - 背景用结果主色的渐变
   - 包含：网站名、结果标题、emoji、一句标语、URL
   - 生成后转成 blob，用于 Web Share API（如果浏览器支持）
2. 分享按钮：
   - "Share on X" → 打开 https://twitter.com/intent/tweet?text=...&url=...
   - "Share on Facebook" → 打开 https://www.facebook.com/sharer/sharer.php?u=...
   - "Copy Link" → 复制当前带参数的 URL，复制成功后按钮文字临时变成 "Copied!"
   - 移动端如果支持 navigator.share，优先用原生分享（传图片 + 文字 + URL）
3. 每次分享 trackEvent('share_clicked', {platform})

【URL 参数】
- 结果页 URL 带 ?result=strategist（用结果的 id）
- 别人打开这个链接 → 跳过答题，直接展示对应结果
- 展示时在结果页加一行小字："Someone shared this result with you. Want to take the quiz yourself?"
  并显示 "Take the Quiz" 按钮
- 如果 ?result= 的值非法，忽略参数，走正常开始页

【OG 标签】
- index.html 里加：
  - og:title / og:description / og:image（先指向一个通用占位图）
  - twitter:card = summary_large_image
- 留好注释：以后可以按结果动态生成 og 图

【音效】
- 用 shared/sound.js 现有的方式，加两个音效：
  - 选项点击（轻）
  - 结果揭晓（上扬）
- 遵守全局静音设置

完成后告诉我：分享流程、URL 参数处理逻辑、Canvas 生成图的实现要点。

========================================
阶段 4：广告位接入
========================================
按以下设计接入广告，全部复用 shared/ads.js。

1. 答题中途插屏：
   - 第 5 题答完后，调用 showInterstitial()
   - 关键：先渲染第 6 题，再异步弹广告，不能卡住答题流程
   - 频率由 ads.js 控制（每 2 次测试最多一次），不要在 quiz.js 里重复写频率逻辑

2. 结果页激励视频：
   - "Unlock Full Report" 按钮 → showRewarded()
   - 奖励：展开 data.fullReport 里的 3 段额外分析，带淡入动画
   - 每份结果只能解锁一次（用 localStorage 按 result_id 记录）
   - 已解锁的状态下，按钮文案改成 "Full Report Unlocked ✓" 并禁用
   - 解锁后 trackEvent('rewarded_unlocked', {result_type})

3. 结果页底部横幅：
   - id="ad-banner"
   - 灰色占位块，文字 "Ad Space"
   - 留注释说明以后替换

4. 开始页底部横幅：
   - 同上

5. 所有广告展示和点击由 ads.js 统一上报，quiz.js 不要重复上报

完成后告诉我：广告点位分布、解锁状态的存储方式、异步弹广告的实现方式。

========================================
阶段 5：体验优化与部署
========================================
1. 首屏加载：
   - 字体用 Inter 或 Poppins（Google Fonts CDN），font-display: swap
   - 关键 CSS 内联
   - data.js 保持轻量

2. 移动端适配：
   - 竖屏优先
   - 所有按钮最小点击区域 44×44px
   - 适配 iPhone 安全区域（env(safe-area-inset-*)）
   - 长题目、长选项要能正常换行不溢出
   - 用 Chrome DevTools 模拟 iPhone SE（375px）和 iPhone 14 Pro Max（430px）检查

3. 防重复 / 提升回访：
   - localStorage 记录上次结果
   - 再次访问开始页时显示 "Last time you got: XXX. Retake?"
   - 记录完成次数，完成 3 次以上给一句不同的欢迎语（可选，简单实现即可）

4. SEO：
   - <html lang="en">
   - <title>：Personality Quiz — What Kind of Gamer Are You?
   - <meta description>：英文，含关键词 "personality quiz", "gaming personality", "free online quiz"
   - og:tags（见阶段 3）

5. README：
   - 在根目录 README.md 里补充 quiz 游戏说明
   - 说明如何新增题目、新增结果类型（改 data.js 的哪些字段）
   - 说明 localStorage 用的 key 名

6. 自测：
   - 完整走一遍：开始 → 答完 10 题 → 结果页 → 分享 → 解锁报告 → Retake
   - 用 ?result=strategist 直接打开，确认跳过答题
   - 用非法参数 ?result=xxx，确认回落到开始页
   - 在 DevTools 手机模式下检查布局
   - 打开控制台确认无报错，埋点事件按预期打印

完成后告诉我：优化点、自测结果、如何本地预览。

========================================
通用要求
========================================
- 代码注释用英文
- 每个文件顶部写清楚用途
- 不要用 npm / webpack / 构建工具
- 移动端优先，竖屏
- 所有外部依赖用 CDN
- 所有面向用户的文案用英文，口语化
- 复用 shared/ 下的模块，不要重复实现广告和埋点逻辑
- 遇到需要我决策的地方（题目内容、结果类型、配色），先问我再动手
- 每完成一个阶段停下来汇报，不要一口气全做完

现在从阶段 1 开始。