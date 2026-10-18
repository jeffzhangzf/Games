/* =========================================================
 * shared/ads.js — 广告统一管理
 * 用途：所有广告调用都走这里，游戏代码不直接接触广告 SDK。
 *       以后换广告平台，只需要改这一个文件。
 *
 * 对外提供三个全局函数：
 *   showInterstitial(callback)  插屏广告。广告关闭后（或本次被频控跳过时）调用 callback
 *   showRewarded(onReward)      激励视频广告。用户完整看完才调用 onReward
 *   showBanner(containerId)     横幅广告。渲染到指定 id 的容器里（首页底部 #ad-banner）
 *
 * 当前：用页面内的模拟弹窗 + console.log 代替真实广告
 * 以后：替换成真实广告 SDK，见各函数里的 TODO 注释
 *       可选平台：Google AdSense H5 Games Ads（Ad Placement API）、
 *                 AdinPlay、GameDistribution 等
 *
 * 依赖：shared/analytics.js（必须先引入），shared/style.css（弹窗样式）
 *
 * 广告总开关 ADS_ENABLED（见下方）：
 *   false（当前）：全站不出任何广告
 *     - 横幅：不显示，<html> 加上 no-ads 类，style.css 会把预留的底部空间收回
 *     - 插屏：直接执行回调
 *     - 激励视频：直接发奖励（看广告复活 / 悔棋 → 免费，次数限制仍由各游戏控制）
 *     - 页面上写着"看广告"的按钮，按各自的 data-noad-* 属性换文案或隐藏：
 *         data-noad-text="…"   关广告时把按钮文字换成这个
 *         data-noad-html="…"   同上，但内容含 HTML（例如按钮里还有 <small>）
 *         data-noad-hide        关广告时直接隐藏（例如"看广告领 2 倍"）
 *   true：恢复所有广告，以上替换都不会发生
 * ========================================================= */

(function () {
  'use strict';

  /* ---------------- 广告总开关 ---------------- */
  // 刚上线先不放广告；以后要接广告，把这里改成 true 即可
  var ADS_ENABLED = false;

  if (!ADS_ENABLED) {
    document.documentElement.classList.add('no-ads');
    // 本脚本在 <body> 末尾引入，此时页面上的按钮都已经存在
    var els = document.querySelectorAll('[data-noad-text], [data-noad-html], [data-noad-hide]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-noad-hide')) el.style.display = 'none';
      else if (el.hasAttribute('data-noad-html')) el.innerHTML = el.getAttribute('data-noad-html');
      else el.textContent = el.getAttribute('data-noad-text');
    }
  }

  /* ---------------- 频率控制配置 ---------------- */

  // 插屏广告：每 N 局最多展示一次（需求：每 2 局最多一次）
  var INTERSTITIAL_EVERY_N_GAMES = 2;

  // 激励广告模拟的"观看时长"（秒），真实广告由 SDK 决定
  var MOCK_REWARDED_SECONDS = 3;

  // 记录调用了多少次插屏（≈ 结束了多少局）。
  // 存在 sessionStorage 里：刷新页面不清零，关掉浏览器标签页后清零。
  var STORAGE_KEY = 'ads_interstitial_count';

  function getCount() {
    try {
      return parseInt(sessionStorage.getItem(STORAGE_KEY), 10) || 0;
    } catch (e) {
      return 0; // 隐私模式下 sessionStorage 可能不可用
    }
  }

  function setCount(n) {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(n));
    } catch (e) {
      /* 忽略 */
    }
  }

  // 安全地上报事件（analytics.js 没加载时也不报错）
  function track(name, params) {
    if (typeof window.trackEvent === 'function') {
      window.trackEvent(name, params);
    }
  }

  /* ---------------- 模拟广告弹窗（仅开发阶段使用） ---------------- */

  /**
   * 创建一个模拟广告弹窗
   * @param {string} type    'interstitial' | 'rewarded'
   * @param {string} title   弹窗中间显示的文字
   * @returns {object} 弹窗中的各个 DOM 元素，方便调用方绑定事件
   */
  function createMockAd(type, title) {
    var mask = document.createElement('div');
    mask.className = 'mock-ad-mask';
    mask.innerHTML =
      '<div class="mock-ad-box">' +
      '  <div class="mock-ad-tag">Ad · Mock</div>' +
      '  <div class="mock-ad-content">' + title + '</div>' +
      '  <button class="mock-ad-btn"></button>' +
      '  <button class="mock-ad-skip"></button>' +
      '</div>';
    document.body.appendChild(mask);

    var content = mask.querySelector('.mock-ad-content');
    // 点击广告内容区 = 模拟"广告点击"
    content.addEventListener('click', function () {
      console.log('[ads] ad clicked: ' + type);
      track('ad_clicked', { type: type });
    });

    return {
      mask: mask,
      btn: mask.querySelector('.mock-ad-btn'),
      skip: mask.querySelector('.mock-ad-skip'),
      close: function () {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      }
    };
  }

  /* ---------------- 对外接口 1：插屏广告 ---------------- */

  /**
   * 插屏广告（一般在一局结束、重新开始前调用）
   * 带频率控制：每 INTERSTITIAL_EVERY_N_GAMES 局才真正展示一次。
   * 不管是否展示，最后都会调用 callback，游戏逻辑不用关心频控细节。
   *
   * @param {function} [callback] 广告关闭后（或被跳过时）执行
   */
  function showInterstitial(callback) {
    var done = typeof callback === 'function' ? callback : function () {};

    // 广告关闭：不展示，直接继续
    if (!ADS_ENABLED) {
      done();
      return;
    }

    var count = getCount() + 1;
    setCount(count);

    // 频控：不到第 N 次，直接跳过
    if (count % INTERSTITIAL_EVERY_N_GAMES !== 0) {
      console.log('[ads] interstitial skipped by frequency cap (call #' + count + ')');
      done();
      return;
    }

    console.log('[ads] showing interstitial (call #' + count + ')');
    track('ad_shown', { type: 'interstitial' });

    /* ------------------------------------------------------
     * TODO：替换成真实广告 SDK
     * 以 Google H5 Games Ads (Ad Placement API) 为例：
     *
     *   adBreak({
     *     type: 'next',               // 关卡/局与局之间
     *     name: 'game_over',
     *     beforeAd: function () { 暂停游戏、静音 },
     *     afterAd:  function () { 恢复声音 },
     *     adBreakDone: function () { done(); }  // 无论是否展示都会回调
     *   });
     *   return;
     *
     * 注意：真实 SDK 自己也有频控，接入后可以按需保留或删除上面的频控逻辑。
     * ------------------------------------------------------ */

    // ↓↓↓ 以下为模拟实现 ↓↓↓
    var ad = createMockAd('interstitial', 'Interstitial ad here<br>(tap to simulate an ad click)');
    ad.btn.textContent = 'Close ad';
    ad.skip.style.display = 'none';
    ad.btn.addEventListener('click', function () {
      ad.close();
      done();
    });
  }

  /* ---------------- 对外接口 2：激励视频广告 ---------------- */

  /**
   * 激励视频广告（例如"看广告复活"）
   * 用户必须看完才发放奖励；中途关闭则不发奖励。
   *
   * @param {function} onReward 用户看完广告后执行（发放奖励）
   * @param {function} [onCancel] 可选：用户中途放弃 / 广告加载失败时执行
   */
  function showRewarded(onReward, onCancel) {
    var reward = typeof onReward === 'function' ? onReward : function () {};
    var cancel = typeof onCancel === 'function' ? onCancel : function () {};

    // 广告关闭：不用看广告，直接发奖励
    if (!ADS_ENABLED) {
      reward();
      return;
    }

    console.log('[ads] showing rewarded ad');
    track('ad_shown', { type: 'rewarded' });

    /* ------------------------------------------------------
     * TODO：替换成真实广告 SDK
     * 以 Google H5 Games Ads (Ad Placement API) 为例：
     *
     *   adBreak({
     *     type: 'reward',
     *     name: 'revive',
     *     beforeReward: function (showAdFn) { showAdFn(); }, // 也可以先弹确认框
     *     adViewed:    function () { reward(); },   // 看完 → 发奖励
     *     adDismissed: function () { cancel(); },   // 中途关闭 → 不发
     *     adBreakDone: function (info) {
     *       if (info.breakStatus !== 'viewed') { 广告没填充等情况，按需处理 }
     *     }
     *   });
     *   return;
     * ------------------------------------------------------ */

    // ↓↓↓ 以下为模拟实现：倒计时结束后才能领取奖励 ↓↓↓
    var ad = createMockAd('rewarded', 'Rewarded video ad here<br>(tap to simulate an ad click)');
    var left = MOCK_REWARDED_SECONDS;

    ad.btn.disabled = true;
    ad.btn.textContent = 'Watch ' + left + 's';
    ad.skip.textContent = 'Skip reward';

    var timer = setInterval(function () {
      left--;
      if (left > 0) {
        ad.btn.textContent = 'Watch ' + left + 's';
      } else {
        clearInterval(timer);
        ad.btn.disabled = false;
        ad.btn.textContent = 'Claim reward';
      }
    }, 1000);

    // 看完 → 领取奖励
    ad.btn.addEventListener('click', function () {
      if (ad.btn.disabled) return;
      ad.close();
      console.log('[ads] rewarded ad watched, granting reward');
      reward();
    });

    // 中途放弃 → 不发奖励
    ad.skip.addEventListener('click', function () {
      clearInterval(timer);
      ad.close();
      console.log('[ads] rewarded ad skipped');
      cancel();
    });
  }

  /* ---------------- 对外接口 3：横幅广告 ---------------- */

  /**
   * 横幅广告：在指定容器中显示（当前为灰色占位块）
   * @param {string} containerId 容器元素的 id，例如 'ad-banner'
   */
  function showBanner(containerId) {
    var container = document.getElementById(containerId);
    if (!container || !ADS_ENABLED) return; // 广告关闭：不显示（容器由 style.css 隐藏）

    /* ------------------------------------------------------
     * TODO：替换成真实广告代码
     * 以 Google AdSense 为例（在 AdSense 后台创建"展示广告"单元后获得）：
     *
     *   1. 在 HTML 的 <head> 里引入（只需一次）：
     *      <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXX"
     *              crossorigin="anonymous"></script>
     *   2. 把下面的占位代码换成：
     *      container.innerHTML =
     *        '<ins class="adsbygoogle" style="display:block;height:100%"' +
     *        ' data-ad-client="ca-pub-XXXXXXXX" data-ad-slot="YYYYYYYY"></ins>';
     *      (window.adsbygoogle = window.adsbygoogle || []).push({});
     *   3. 真实广告的展示/点击由 AdSense 后台统计，可以删掉下面的 track 调用
     * ------------------------------------------------------ */

    // ↓↓↓ 以下为模拟实现：灰色占位块 ↓↓↓
    container.innerHTML = '<div class="mock-ad-banner">Ad Space</div>';
    console.log('[ads] showing banner');
    track('ad_shown', { type: 'banner' });

    container.firstChild.addEventListener('click', function () {
      console.log('[ads] ad clicked: banner');
      track('ad_clicked', { type: 'banner' });
    });
  }

  // 挂到全局，供游戏调用
  window.adsEnabled = function () { return ADS_ENABLED; };
  window.showInterstitial = showInterstitial;
  window.showRewarded = showRewarded;
  window.showBanner = showBanner;
})();
