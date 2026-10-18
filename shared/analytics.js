/* =========================================================
 * shared/analytics.js — 埋点（数据统计）
 * 用途：统一的事件上报入口，所有页面都通过 trackEvent() 上报
 *
 * 当前：只在控制台打印（console.log），方便本地调试
 * 以后：接入 Google Analytics 4（GA4），步骤见下方注释
 *
 * 使用方式（在 HTML 里先引入本文件）：
 *   <script src="../shared/analytics.js"></script>
 *   trackEvent('game_start', { game: 'merge' });
 *
 * 说明：项目不使用构建工具，所以这里不用 import/export，
 *       而是把函数挂到 window 上，作为全局函数使用。
 * ========================================================= */

(function () {
  'use strict';

  /**
   * 事件名常量表。统一在这里定义，避免各处手写字符串拼错。
   * 新增事件时在这里加一行即可。
   */
  var EVENTS = {
    GAME_START: 'game_start',   // 开始一局游戏
    GAME_END: 'game_end',       // 一局游戏结束，参数：{ score }
    AD_SHOWN: 'ad_shown',       // 广告展示，参数：{ type: 'interstitial' | 'rewarded' | 'banner' }
    AD_CLICKED: 'ad_clicked',   // 广告被点击，参数：{ type }
    REVIVE_USED: 'revive_used', // 使用了"看广告复活"
    UNDO_USED: 'undo_used',     // 使用了"看广告悔棋"（二打一）

    // 首页
    GAME_CARD_CLICK: 'game_card_click', // 点了首页的游戏卡片，参数：{ game, featured, position }

    // 挂机农场
    IDLE_START: 'idle_start',                             // 第一次进入游戏
    CROP_PLANTED: 'crop_planted',                         // 种植，参数：{ crop_id }
    CROP_HARVESTED: 'crop_harvested',                     // 收获，参数：{ crop_id, value }
    ANIMAL_COLLECTED: 'animal_collected',                 // 收集动物产出，参数：{ animal_id, value }
    UPGRADE_PURCHASED: 'upgrade_purchased',               // 购买升级，参数：{ upgrade_id }
    OFFLINE_EARNINGS_CLAIMED: 'offline_earnings_claimed', // 领取离线收益，参数：{ amount }

    // 打气球
    BALLOON_HIT: 'balloon_hit',             // 打中气球，参数：{ type: 'normal' | 'gold' | 'bomb' }
    RELOAD: 'reload',                       // 换弹

    // 游戏人格测试
    QUIZ_START: 'quiz_start',               // 进入第一题
    QUIZ_ANSWER: 'quiz_answer',             // 选了一个选项，参数：{ question_index }
    QUIZ_COMPLETE: 'quiz_complete',         // 答完进入结果页，参数：{ result_type }
    SHARE_CLICKED: 'share_clicked',         // 点了分享，参数：{ platform }
    REWARDED_UNLOCKED: 'rewarded_unlocked', // 看完激励视频解锁完整报告，参数：{ result_type }

    MERGE: 'merge'              // 合成一次，参数：{ value }（阶段 2 使用）
  };

  // 是否在控制台打印事件（上线后可以改成 false）
  var DEBUG = true;

  /**
   * 上报一个事件
   * @param {string} name   事件名，建议使用 EVENTS 里的常量
   * @param {object} params 附加参数（可选），例如 { score: 128 }
   */
  function trackEvent(name, params) {
    params = params || {};

    // 自动附带一些公共字段，方便以后分析
    var payload = Object.assign(
      {
        page: location.pathname, // 当前页面路径
        ts: Date.now()           // 时间戳（毫秒）
      },
      params
    );

    if (DEBUG) {
      console.log('[analytics]', name, payload);
    }

    /* ------------------------------------------------------
     * TODO：接入 Google Analytics 4
     *
     * 1. 在 GA 后台创建"网站"数据流，拿到衡量 ID（形如 G-XXXXXXXXXX）
     * 2. 在每个 HTML 的 <head> 里加入 GA 官方代码：
     *      <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
     *      <script>
     *        window.dataLayer = window.dataLayer || [];
     *        function gtag(){ dataLayer.push(arguments); }
     *        gtag('js', new Date());
     *        gtag('config', 'G-XXXXXXXXXX');
     *      </script>
     * 3. 取消下面这段代码的注释即可：
     *
     *    if (typeof window.gtag === 'function') {
     *      window.gtag('event', name, params);
     *    }
     * ------------------------------------------------------ */
  }

  // 挂到全局，供其他脚本使用
  window.trackEvent = trackEvent;
  window.EVENTS = EVENTS;
})();
