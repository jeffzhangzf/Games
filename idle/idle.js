/* =========================================================
 * idle/idle.js — 挂机农场 游戏逻辑
 *
 * 用途：游戏状态、生长/产出循环、种植与收获、商店、升级、离线收益、存档、界面
 *
 * 依赖（idle/index.html 按顺序引入）：
 *   shared/analytics.js → shared/ads.js → shared/sound.js → idle/data.js → 本文件
 *
 * 核心设计：
 *   - 所有"时间"都存成绝对时间戳（Date.now()）：作物存"成熟时刻"，动物存"下一个产出时刻"。
 *     这样不管页面开着、切到后台还是关掉，重新打开时一算就知道现在长到哪了。
 *   - 每帧（requestAnimationFrame）只做两件事：更新进度条、发现状态变化（成熟/产出）时重画那一格。
 *   - 金币只在玩家操作时变化（收获、收集、购买、领离线收益），所以商店面板只在这些时候刷新。
 *   - 存档：每 5 秒自动保存 + 切到后台/关闭页面时保存（localStorage 键名 SAVE_KEY）。
 *   - 新手引导：只给没有存档的新玩家，看完记 TUTORIAL_KEY（见第 11 节）。
 * ========================================================= */

(function () {
  'use strict';

  const D = window.IdleData;

  const CONFIG = {
    SAVE_KEY: 'idle_farm_save',  // 存档在 localStorage 中的键名
    SAVE_VERSION: 1,             // 存档格式版本，以后改格式时用来做迁移
    SAVE_INTERVAL: 5000,         // 自动保存间隔（毫秒）
    TOAST_TIME: 1800,            // 提示条显示时长（毫秒）
    TUTORIAL_KEY: 'idle_tutorial_seen' // 是否看过新手引导（"1" = 看过）
  };

  /* =========================================================
   * 1. 兜底：公共脚本没加载到时不让游戏崩溃
   * ========================================================= */
  const track = (name, params) => {
    if (typeof window.trackEvent === 'function') window.trackEvent(name, params);
  };
  const EV = window.EVENTS || {};
  const playSound = (name) => {
    if (window.Sound) window.Sound.play(name);
  };
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* 忽略 */
    }
  }

  /* =========================================================
   * 2. 工具函数
   * ========================================================= */

  /** 数字格式化：1234 → 1.2K，1500000 → 1.5M；小于 10 的小数保留 1 位（用于每秒收益） */
  function fmt(n) {
    if (n < 1000) {
      if (n > 0 && n < 10 && n % 1 !== 0) return (Math.floor(n * 10) / 10).toString();
      return Math.floor(n).toString();
    }
    const units = ['K', 'M', 'B', 'T'];
    let u = -1;
    while (n >= 1000 && u < units.length - 1) {
      n /= 1000;
      u++;
    }
    const digits = n < 10 ? 2 : n < 100 ? 1 : 0;
    // 向下取整到对应小数位，避免 999.95K 显示成 1000K；再去掉多余的 0
    const p = Math.pow(10, digits);
    return parseFloat((Math.floor(n * p) / p).toFixed(digits)).toString() + units[u];
  }

  /** 时长格式化：65 → "1分5秒"，7300 → "2小时1分" */
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm' + (sec % 60 ? ' ' + (sec % 60) + 's' : '');
    const h = Math.floor(m / 60);
    return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }

  const cropById = (id) => D.crops.find((c) => c.id === id);
  const animalById = (id) => D.animals.find((a) => a.id === id);
  const upgradeByType = (type) => D.upgrades.find((u) => u.effect.type === type);

  /* =========================================================
   * 3. 游戏状态 & 存档
   * ========================================================= */

  /**
   * state.plots 每一格是下面三种之一：
   *   null                                            空地
   *   { type: 'crop', id, readyAt, growMs }           作物：readyAt 成熟时刻
   *   { type: 'animal', id, stock, nextAt }           动物：stock 攒着的产出数，nextAt 下一个产出时刻
   */
  let state = null;

  function newState() {
    return {
      version: CONFIG.SAVE_VERSION,
      coins: D.START_COINS,
      plots: new Array(D.START_PLOTS).fill(null),
      unlockedCrops: D.crops.filter((c) => c.unlockCost === 0).map((c) => c.id),
      unlockedAnimals: [],
      upgrades: {},          // 升级 id → 等级
      lastSeen: Date.now()   // 最后在线时间（计算离线收益用）
    };
  }

  /** 读档；没有存档或存档损坏时返回 null */
  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(CONFIG.SAVE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (!s || typeof s.coins !== 'number' || !Array.isArray(s.plots)) return null;
      // 过滤掉配置里已经不存在的作物/动物（例如以后删了某种作物）
      s.plots = s.plots.map((p) => {
        if (!p) return null;
        if (p.type === 'crop' && cropById(p.id)) return p;
        if (p.type === 'animal' && animalById(p.id)) return p;
        return null;
      });
      s.unlockedCrops = (s.unlockedCrops || []).filter(cropById);
      s.unlockedAnimals = (s.unlockedAnimals || []).filter(animalById);
      s.upgrades = s.upgrades || {};
      s.lastSeen = s.lastSeen || Date.now();
      return s;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    state.lastSeen = Date.now();
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 隐私模式 / 存储满了，忽略 */
    }
  }

  /* =========================================================
   * 4. 数值计算（全部根据 data.js + 当前升级等级）
   * ========================================================= */

  function upgradeLevel(id) {
    return state.upgrades[id] || 0;
  }

  /** 某种升级效果的当前数值：perLevel × 等级 */
  function effectOf(type) {
    const u = upgradeByType(type);
    return u ? u.effect.perLevel * upgradeLevel(u.id) : 0;
  }

  function growSeconds(crop) {
    const u = upgradeByType('growSpeed');
    const lv = u ? upgradeLevel(u.id) : 0;
    return crop.growTime * Math.pow(1 - (u ? u.effect.perLevel : 0), lv);
  }
  const cropSell = (crop) => Math.round(crop.sellPrice * (1 + effectOf('cropValue')));
  const animalValue = (a) => Math.round(a.produceValue * (1 + effectOf('animalValue')));
  const plotCount = () => Math.min(D.MAX_PLOTS, D.START_PLOTS + effectOf('plots'));
  const offlineRate = () => D.OFFLINE_BASE_RATE + effectOf('offlineRate');

  function upgradeCost(u) {
    return Math.round(u.baseCost * Math.pow(u.costMultiplier, upgradeLevel(u.id)));
  }

  /** 每秒收益：农场上每一格（作物按"一直重种"、动物按"一直有人收"）的理论收益之和 */
  function ratePerSec() {
    let rate = 0;
    for (const p of state.plots) {
      if (!p) continue;
      if (p.type === 'crop') {
        const c = cropById(p.id);
        rate += (cropSell(c) - c.seedCost) / growSeconds(c);
      } else {
        const a = animalById(p.id);
        rate += animalValue(a) / a.produceTime;
      }
    }
    return rate;
  }

  /** 把动物的产出推进到 now（攒满就停） */
  function advanceAnimal(p, now) {
    const ms = animalById(p.id).produceTime * 1000;
    while (p.stock < D.ANIMAL_MAX_STOCK && now >= p.nextAt) {
      p.stock++;
      p.nextAt += ms;
    }
  }

  /* =========================================================
   * 5. 页面元素
   * ========================================================= */
  const $ = (id) => document.getElementById(id);
  const ui = {
    coins: $('coins'),
    rate: $('rate'),
    farm: $('farm'),
    btnSeeds: $('btn-seeds'),
    btnAnimals: $('btn-animals'),
    btnUpgrades: $('btn-upgrades'),
    sheet: $('sheet'),
    sheetTitle: $('sheet-title'),
    sheetCoins: $('sheet-coins'),
    sheetBody: $('sheet-body'),
    welcome: $('welcome'),
    awayTime: $('away-time'),
    offlineAmount: $('offline-amount'),
    offlineHint: $('offline-hint'),
    btnOffline2x: $('btn-offline-2x'),
    btnOfflineClaim: $('btn-offline-claim'),
    btnMute: $('btn-mute'),
    guide: $('guide'),
    guideText: $('guide-text'),
    guideBtn: $('guide-btn'),
    toast: $('toast')
  };

  /** 地块上的小动画（种下 / 收获时弹一下） */
  function popPlot(el) {
    el.classList.remove('pop');
    void el.offsetWidth; // 重新触发动画
    el.classList.add('pop');
  }

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), CONFIG.TOAST_TIME);
  }

  /** 在某个元素上方飘一个"+金币"文字 */
  function floatText(el, text) {
    const r = el.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'float-coin';
    f.textContent = text;
    f.style.left = r.left + r.width / 2 + 'px';
    f.style.top = r.top + r.height / 3 + 'px';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 800);
  }

  /* =========================================================
   * 6. 金币变化（所有加减钱都走这里，统一刷新界面）
   * ========================================================= */

  function addCoins(n) {
    state.coins += n;
    onCoinsChanged();
    if (n > 0) {
      const el = ui.coins.parentNode;
      el.classList.remove('bump');
      void el.offsetWidth; // 强制重排，重新触发动画
      el.classList.add('bump');
    }
  }

  /** 花钱：钱不够返回 false */
  function spend(n) {
    if (state.coins < n) {
      toast('Not enough coins');
      playSound('deny');
      return false;
    }
    state.coins -= n;
    onCoinsChanged();
    return true;
  }

  function onCoinsChanged() {
    updateTopbar();
    updateBadges();
    if (sheetRender) refreshSheet();
  }

  function updateTopbar() {
    ui.coins.textContent = fmt(state.coins);
    ui.rate.textContent = fmt(ratePerSec());
  }

  /** 底部按钮的小红点：有东西买得起时提醒 */
  function updateBadges() {
    const c = state.coins;
    const nextCrop = D.crops.find((x) => !state.unlockedCrops.includes(x.id));
    const nextAnimal = D.animals.find((x) => !state.unlockedAnimals.includes(x.id));
    ui.btnSeeds.classList.toggle('notify', !!nextCrop && c >= nextCrop.unlockCost);
    ui.btnAnimals.classList.toggle('notify', !!nextAnimal && c >= nextAnimal.unlockCost);
    ui.btnUpgrades.classList.toggle('notify', D.upgrades.some((u) => upgradeLevel(u.id) < u.maxLevel && c >= upgradeCost(u)));
  }

  /* =========================================================
   * 7. 农场网格
   * ========================================================= */

  let plotEls = [];

  /** 地块数量变化（开局 / 扩建）时重建整个网格 */
  function buildFarm() {
    while (state.plots.length < plotCount()) state.plots.push(null);
    ui.farm.innerHTML = '';
    plotEls = state.plots.map((_, i) => {
      const el = document.createElement('div');
      el.className = 'plot';
      el.dataset.index = i;
      el.innerHTML = '<span class="emoji"></span><span class="label"></span><span class="bar"><i></i></span><span class="stock"></span>';
      el._emoji = el.children[0];
      el._label = el.children[1];
      el._barWrap = el.children[2];
      el._bar = el.children[2].firstChild;
      el._stock = el.children[3];
      el._key = '';
      ui.farm.appendChild(el);
      return el;
    });
    updatePlots(Date.now());
  }

  /**
   * 每帧调用：更新进度条和剩余时间；状态（空地/生长/成熟/动物攒货）变化时才改 class 和图标
   */
  function updatePlots(now) {
    for (let i = 0; i < plotEls.length; i++) {
      const el = plotEls[i];
      const p = state.plots[i];
      let key, cls, emoji, label, progress = -1, stockText = '';

      if (!p) {
        key = 'empty';
        cls = 'plot empty';
        emoji = '＋';
        label = 'Empty';
      } else if (p.type === 'crop') {
        const c = cropById(p.id);
        const left = (p.readyAt - now) / 1000;
        if (left > 0) {
          key = 'grow:' + p.id;
          cls = 'plot growing has-bar';
          label = fmtTime(left);
          progress = 1 - left * 1000 / p.growMs;
        } else {
          key = 'ripe:' + p.id;
          cls = 'plot ripe';
          label = 'Ready!';
        }
        emoji = c.emoji;
      } else {
        const a = animalById(p.id);
        advanceAnimal(p, now);
        const full = p.stock >= D.ANIMAL_MAX_STOCK;
        key = 'animal:' + p.id + ':' + p.stock;
        cls = 'plot animal has-bar' + (p.stock ? ' has-stock' : '');
        emoji = a.emoji;
        if (full) {
          label = 'Full';
          progress = 1;
        } else {
          const left = (p.nextAt - now) / 1000;
          label = p.stock ? 'Collect!' : fmtTime(left);
          progress = 1 - left / a.produceTime;
        }
        if (p.stock) stockText = a.product + '×' + p.stock;
      }

      // 状态变了才动 DOM 结构
      if (key !== el._key) {
        el._key = key;
        el.className = cls;
        el._emoji.textContent = emoji;
        el._stock.textContent = stockText;
        el._stock.style.display = stockText ? '' : 'none';
        el._barWrap.style.display = progress >= 0 ? '' : 'none';
      }
      // 新手引导高亮（className 会在状态变化时被整体替换，所以每帧单独同步）
      el.classList.toggle('guide', i === tutorial.plot);
      if (el._label.textContent !== label) el._label.textContent = label;
      if (progress >= 0) el._bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, progress)) + ')';
    }
  }

  /** 点击地块 */
  function onPlotTap(i) {
    const p = state.plots[i];
    const el = plotEls[i];
    if (!p) {
      openPlantSheet(i);
      return;
    }
    if (p.type === 'crop') {
      const left = (p.readyAt - Date.now()) / 1000;
      if (left > 0) {
        toast(cropById(p.id).name + ' will be ready in ' + fmtTime(left));
        return;
      }
      harvest(i, el);
      return;
    }
    // 动物：有产出就收集，没有就打开详情（可以卖掉腾地方）
    advanceAnimal(p, Date.now());
    if (p.stock > 0) collect(i, el);
    else openAnimalInfo(i);
  }

  /* =========================================================
   * 8. 种植 / 收获 / 动物
   * ========================================================= */

  /** 在第 i 块地种下作物；成功返回 true */
  function plant(i, crop, silent) {
    if (state.plots[i]) return false;
    if (state.coins < crop.seedCost) {
      if (!silent) {
        toast('Not enough coins');
        playSound('deny');
      }
      return false;
    }
    const growMs = growSeconds(crop) * 1000;
    state.plots[i] = { type: 'crop', id: crop.id, readyAt: Date.now() + growMs, growMs: growMs };
    state.coins -= crop.seedCost;
    if (plotEls[i]) popPlot(plotEls[i]);
    playSound('plant');
    track(EV.CROP_PLANTED, { crop_id: crop.id });
    tutorialOn('plant', i);
    return true;
  }

  function harvest(i, el) {
    const p = state.plots[i];
    const c = cropById(p.id);
    const value = cropSell(c);
    state.plots[i] = null;
    floatText(el, '+' + fmt(value));
    playSound('harvest');
    popPlot(el);
    addCoins(value);
    updatePlots(Date.now());
    track(EV.CROP_HARVESTED, { crop_id: c.id, value: value });
    tutorialOn('harvest', i);
  }

  function collect(i, el) {
    const p = state.plots[i];
    const a = animalById(p.id);
    const value = p.stock * animalValue(a);
    // 攒满时产出是暂停的：收走后从现在重新开始计时；没满则继续原来的计时
    if (p.stock >= D.ANIMAL_MAX_STOCK) p.nextAt = Date.now() + a.produceTime * 1000;
    p.stock = 0;
    floatText(el, '+' + fmt(value));
    playSound('collect');
    popPlot(el);
    addCoins(value);
    updatePlots(Date.now());
    track(EV.ANIMAL_COLLECTED, { animal_id: a.id, value: value });
  }

  /** 把动物放到第 i 块地（i 省略时放到第一块空地） */
  function placeAnimal(a, i) {
    if (i === undefined) i = state.plots.indexOf(null);
    if (i < 0) {
      toast('No empty plots: harvest something first, or expand your farm');
      return false;
    }
    if (!spend(a.buyCost)) return false;
    state.plots[i] = { type: 'animal', id: a.id, stock: 0, nextAt: Date.now() + a.produceTime * 1000 };
    playSound('buy');
    if (plotEls[i]) popPlot(plotEls[i]);
    afterFarmChange();
    toast(a.emoji + ' ' + a.name + ' moved into your farm!');
    return true;
  }

  function sellAnimal(i) {
    const a = animalById(state.plots[i].id);
    state.plots[i] = null;
    addCoins(Math.floor(a.buyCost * D.ANIMAL_SELL_REFUND));
    afterFarmChange();
  }

  function unlockCrop(c) {
    if (!spend(c.unlockCost)) return;
    state.unlockedCrops.push(c.id);
    toast('Unlocked ' + c.emoji + ' ' + c.name + '!');
    playSound('buy');
    refreshSheet();
    saveState();
  }

  function unlockAnimal(a) {
    if (!spend(a.unlockCost)) return;
    state.unlockedAnimals.push(a.id);
    toast('Unlocked ' + a.emoji + ' ' + a.name + '!');
    playSound('buy');
    refreshSheet();
    saveState();
  }

  function buyUpgrade(u) {
    if (upgradeLevel(u.id) >= u.maxLevel) return;
    if (!spend(upgradeCost(u))) return;
    state.upgrades[u.id] = upgradeLevel(u.id) + 1;
    track(EV.UPGRADE_PURCHASED, { upgrade_id: u.id });
    toast(u.name + ' is now level ' + state.upgrades[u.id]);
    playSound('buy');
    if (u.effect.type === 'plots') buildFarm();
    afterFarmChange();
  }

  /** 农场内容变化后：重画、刷新每秒收益、存档 */
  function afterFarmChange() {
    updatePlots(Date.now());
    onCoinsChanged();
    saveState();
  }

  /* =========================================================
   * 9. 底部弹出面板
   *   sheetRender 保存"怎么画当前面板"的函数，金币变化时重新调用它刷新按钮状态
   * ========================================================= */

  let sheetRender = null;

  function openSheet(title, render) {
    ui.sheetTitle.textContent = title;
    sheetRender = render;
    refreshSheet();
    ui.sheet.classList.remove('hidden');
  }

  function closeSheet() {
    sheetRender = null;
    ui.sheet.classList.add('hidden');
  }

  function refreshSheet() {
    if (!sheetRender) return;
    ui.sheetCoins.textContent = '💰 ' + fmt(state.coins);
    const scroll = ui.sheetBody.scrollTop;
    ui.sheetBody.innerHTML = '';
    sheetRender(ui.sheetBody);
    ui.sheetBody.scrollTop = scroll; // 刷新后保持滚动位置
  }

  /**
   * 生成面板中的一行
   * @param {object} o { emoji, name, tag, desc, locked, buttons: [{ text, onClick, disabled, style }] }
   */
  function row(parent, o) {
    const r = document.createElement('div');
    r.className = 'row' + (o.locked ? ' locked' : '');
    r.innerHTML =
      '<div class="r-emoji">' + o.emoji + '</div>' +
      '<div class="r-info"><div class="r-name">' + o.name + (o.tag ? '<small>' + o.tag + '</small>' : '') + '</div>' +
      '<div class="r-desc">' + o.desc + '</div></div>' +
      '<div class="r-btns"></div>';
    const btns = r.querySelector('.r-btns');
    for (const b of o.buttons || []) {
      const el = document.createElement('button');
      el.className = 'buy' + (b.style ? ' ' + b.style : '');
      el.textContent = b.text;
      el.disabled = !!b.disabled;
      el.addEventListener('click', b.onClick);
      btns.appendChild(el);
    }
    parent.appendChild(r);
  }

  function section(parent, text) {
    const s = document.createElement('div');
    s.className = 'section';
    s.textContent = text;
    parent.appendChild(s);
  }

  const priceText = (n) => (n === 0 ? 'Free' : '💰' + fmt(n));
  const cropDesc = (c) => 'Grows in ' + fmtTime(growSeconds(c)) + ' · sells for ' + fmt(cropSell(c));
  const animalDesc = (a) => '1 ' + a.product + ' every ' + fmtTime(a.produceTime) + ' · worth ' + fmt(animalValue(a));

  /** 点空地：选种子（也可以放动物） */
  function openPlantSheet(i) {
    openSheet('What to plant?', (body) => {
      if (state.plots[i]) { // 面板开着时这块地已经被占了
        closeSheet();
        return;
      }
      for (const c of D.crops) {
        if (!state.unlockedCrops.includes(c.id)) continue;
        row(body, {
          emoji: c.emoji, name: c.name, desc: cropDesc(c),
          buttons: [{
            text: 'Plant ' + priceText(c.seedCost),
            disabled: state.coins < c.seedCost,
            onClick: () => {
              if (plant(i, c)) {
                closeSheet();
                afterFarmChange();
              }
            }
          }]
        });
      }
      const nextCrop = D.crops.find((c) => !state.unlockedCrops.includes(c.id));
      if (nextCrop) {
        row(body, {
          emoji: nextCrop.emoji, name: nextCrop.name, tag: 'Locked', locked: true, desc: cropDesc(nextCrop),
          buttons: [{ text: 'Unlock ' + priceText(nextCrop.unlockCost), style: 'gold', disabled: state.coins < nextCrop.unlockCost, onClick: () => unlockCrop(nextCrop) }]
        });
      }
      const animals = D.animals.filter((a) => state.unlockedAnimals.includes(a.id));
      if (animals.length) {
        section(body, 'Or put an animal here (it keeps the plot)');
        for (const a of animals) {
          row(body, {
            emoji: a.emoji, name: a.name, desc: animalDesc(a),
            buttons: [{
              text: 'Place ' + priceText(a.buyCost),
              disabled: state.coins < a.buyCost,
              onClick: () => {
                if (placeAnimal(a, i)) closeSheet();
              }
            }]
          });
        }
      }
    });
  }

  /** 种子商店：解锁新种子、一键种满空地 */
  function openSeedShop() {
    openSheet('Seed Shop', (body) => {
      const empties = state.plots.filter((p) => !p).length;
      for (const c of D.crops) {
        const unlocked = state.unlockedCrops.includes(c.id);
        if (unlocked) {
          row(body, {
            emoji: c.emoji, name: c.name, desc: cropDesc(c) + ' · seeds ' + priceText(c.seedCost),
            buttons: [{
              text: 'Fill empty (' + empties + ')',
              style: 'alt',
              disabled: empties === 0 || state.coins < c.seedCost,
              onClick: () => plantAll(c)
            }]
          });
        } else {
          row(body, {
            emoji: c.emoji, name: c.name, tag: 'Locked', locked: true, desc: cropDesc(c) + ' · seeds ' + priceText(c.seedCost),
            buttons: [{ text: 'Unlock ' + priceText(c.unlockCost), style: 'gold', disabled: state.coins < c.unlockCost, onClick: () => unlockCrop(c) }]
          });
        }
      }
    });
  }

  /** 把所有空地都种上某种作物（钱不够就种到没钱为止） */
  function plantAll(c) {
    let n = 0;
    for (let i = 0; i < state.plots.length; i++) {
      if (!state.plots[i] && plant(i, c, true)) n++;
    }
    if (n) toast('Planted ' + n + ' × ' + c.name);
    else toast('Not enough coins');
    afterFarmChange();
  }

  /** 动物商店：解锁动物、买一只放进农场 */
  function openAnimalShop() {
    openSheet('Animal Shop', (body) => {
      const hasEmpty = state.plots.includes(null);
      for (const a of D.animals) {
        const unlocked = state.unlockedAnimals.includes(a.id);
        row(body, {
          emoji: a.emoji, name: a.name, tag: unlocked ? '' : 'Locked', locked: !unlocked, desc: animalDesc(a),
          buttons: unlocked
            ? [{ text: 'Buy ' + priceText(a.buyCost), disabled: state.coins < a.buyCost || !hasEmpty, onClick: () => placeAnimal(a) }]
            : [{ text: 'Unlock ' + priceText(a.unlockCost), style: 'gold', disabled: state.coins < a.unlockCost, onClick: () => unlockAnimal(a) }]
        });
      }
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = hasEmpty
        ? 'Animals take up a plot and stop producing at ' + D.ANIMAL_MAX_STOCK + ' items, so check in often'
        : 'No empty plots: harvest something first, or expand your farm in Upgrades';
      body.appendChild(note);
    });
  }

  /** 升级面板 */
  function openUpgrades() {
    openSheet('Upgrades', (body) => {
      for (const u of D.upgrades) {
        const lv = upgradeLevel(u.id);
        const maxed = lv >= u.maxLevel;
        row(body, {
          emoji: { growSpeed: '🧪', cropValue: '🏪', animalValue: '🌽', plots: '🚜', offlineRate: '👨‍🌾' }[u.effect.type] || '⬆️',
          name: u.name, tag: 'Lv.' + lv + '/' + u.maxLevel,
          desc: u.description + '<br>' + upgradeNow(u),
          buttons: [{
            text: maxed ? 'Maxed' : 'Upgrade ' + priceText(upgradeCost(u)),
            disabled: maxed || state.coins < upgradeCost(u),
            onClick: () => buyUpgrade(u)
          }]
        });
      }
    });
  }

  /** 升级当前效果的一句话说明 */
  function upgradeNow(u) {
    const v = u.effect.perLevel * upgradeLevel(u.id);
    switch (u.effect.type) {
      case 'growSpeed': return 'Now: grow time ×' + Math.pow(1 - u.effect.perLevel, upgradeLevel(u.id)).toFixed(2);
      case 'cropValue': return 'Now: +' + Math.round(v * 100) + '% sell price';
      case 'animalValue': return 'Now: +' + Math.round(v * 100) + '% animal output';
      case 'plots': return 'Now: ' + plotCount() + ' plots';
      case 'offlineRate': return 'Now: ' + Math.round(offlineRate() * 100) + '% offline earnings';
      default: return '';
    }
  }

  /** 点没有产出的动物：看进度，可以卖掉腾出地块 */
  function openAnimalInfo(i) {
    const a = animalById(state.plots[i].id);
    openSheet(a.emoji + ' ' + a.name, (body) => {
      const p = state.plots[i];
      if (!p || p.type !== 'animal') {
        closeSheet();
        return;
      }
      const left = Math.max(0, (p.nextAt - Date.now()) / 1000);
      row(body, {
        emoji: a.product, name: 'Next ' + a.product, desc: 'Ready in about ' + fmtTime(left) + ' · ' + animalDesc(a),
        buttons: []
      });
      row(body, {
        emoji: '💸', name: 'Sell', desc: 'Get back ' + Math.round(D.ANIMAL_SELL_REFUND * 100) + '% of the price and free up this plot',
        buttons: [{
          text: 'Sell +' + fmt(Math.floor(a.buyCost * D.ANIMAL_SELL_REFUND)),
          style: 'alt',
          onClick: () => {
            sellAnimal(i);
            closeSheet();
          }
        }]
      });
    });
  }

  /* =========================================================
   * 10. 离线收益
   * ========================================================= */

  let pendingOffline = 0; // 当前"欢迎回来"弹窗里待领取的金额

  /**
   * 离开了 awaySec 秒：按 离开时长(最多 OFFLINE_MAX_HOURS) × 每秒收益 × 离线比例 计算，
   * 超过 OFFLINE_MIN_SECONDS 且金额 > 0 才弹窗
   */
  function checkOffline(awaySec) {
    if (awaySec < D.OFFLINE_MIN_SECONDS) return;
    const counted = Math.min(awaySec, D.OFFLINE_MAX_HOURS * 3600);
    const amount = Math.floor(counted * ratePerSec() * offlineRate());
    if (amount <= 0) return;

    pendingOffline = amount;
    ui.awayTime.textContent = fmtTime(awaySec);
    ui.offlineAmount.textContent = fmt(amount);
    ui.offlineHint.textContent = 'Offline earnings: ' + Math.round(offlineRate() * 100) + '%, up to ' + D.OFFLINE_MAX_HOURS + ' hours';
    ui.btnOffline2x.disabled = false;
    ui.welcome.classList.remove('hidden');
  }

  function claimOffline(multiplier) {
    if (!pendingOffline) return;
    const amount = pendingOffline * multiplier;
    pendingOffline = 0;
    ui.welcome.classList.add('hidden');
    addCoins(amount);
    playSound('win');
    saveState();
    track(EV.OFFLINE_EARNINGS_CLAIMED, { amount: amount, multiplier: multiplier });
    toast('Collected 💰' + fmt(amount));
  }

  ui.btnOfflineClaim.addEventListener('click', () => claimOffline(1));
  ui.btnOffline2x.addEventListener('click', () => {
    if (typeof window.showRewarded !== 'function') return claimOffline(1);
    ui.btnOffline2x.disabled = true; // 防止连点打开多个广告
    window.showRewarded(
      () => claimOffline(2),
      () => { ui.btnOffline2x.disabled = false; } // 中途放弃：还可以再选
    );
  });

  /* =========================================================
   * 11. 新手引导（只给第一次进入的新玩家）
   *   step 0：点空地种下第一株小麦（高亮第一块空地）
   *   step 1：等它成熟，点它收获（高亮刚种下的那块地）
   *   step 2：说明怎么继续玩、离线也会赚钱，点"知道了"结束
   *   看完记 TUTORIAL_KEY = "1"，以后不再出现
   * ========================================================= */

  const tutorial = { step: -1, plot: -1 }; // step -1 = 不在引导中；plot = 高亮的地块下标

  const TUTORIAL_TEXT = [
    '👆 Tap an empty plot and plant your first wheat (seeds are free)',
    '⏳ Wheat is ready in 5 seconds — tap it to harvest',
    '💰 Keep planting! Save up to unlock new seeds, buy animals and upgrade your farm. Your farm keeps earning even when you close the page'
  ];

  function showTutorialStep(step, plot) {
    tutorial.step = step;
    tutorial.plot = plot;
    ui.guideText.textContent = TUTORIAL_TEXT[step];
    ui.guideBtn.hidden = step !== 2;
    ui.guide.hidden = false;
    ui.guide.classList.remove('enter');
    void ui.guide.offsetWidth;
    ui.guide.classList.add('enter');
  }

  function endTutorial() {
    tutorial.step = -1;
    tutorial.plot = -1;
    ui.guide.hidden = true;
    storageSet(CONFIG.TUTORIAL_KEY, '1');
  }

  /** 玩家操作时由 plant / harvest 调用，推进引导 */
  function tutorialOn(action, i) {
    if (tutorial.step === 0 && action === 'plant') showTutorialStep(1, i);
    else if (tutorial.step === 1 && action === 'harvest') showTutorialStep(2, -1);
  }

  function startTutorial(isNewPlayer) {
    if (storageGet(CONFIG.TUTORIAL_KEY)) return;
    if (!isNewPlayer) {
      storageSet(CONFIG.TUTORIAL_KEY, '1'); // 老存档玩家已经会玩了，不打扰
      return;
    }
    showTutorialStep(0, state.plots.indexOf(null));
  }

  ui.guideBtn.addEventListener('click', endTutorial);

  /* =========================================================
   * 12. 静音开关
   * ========================================================= */
  function updateMuteUI() {
    ui.btnMute.textContent = window.Sound && window.Sound.isMuted() ? '🔇' : '🔊';
  }
  ui.btnMute.addEventListener('click', () => {
    if (window.Sound) window.Sound.toggle();
    updateMuteUI();
  });
  updateMuteUI();

  /* =========================================================
   * 13. 主循环 & 生命周期
   * ========================================================= */

  function frame() {
    updatePlots(Date.now());
    requestAnimationFrame(frame);
  }

  // 每 5 秒自动保存（页面在后台时不存：让 lastSeen 停在离开的时刻，离线时长才算得准）
  setInterval(() => {
    if (!document.hidden) saveState();
  }, CONFIG.SAVE_INTERVAL);

  // 切到后台：立刻保存并记下时间；回来时按离开时长发离线收益
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveState();
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      if (!pendingOffline) checkOffline(away);
    }
  });
  // 关闭 / 刷新页面前保存（pagehide 在手机浏览器上比 beforeunload 更可靠，两个都挂上）
  window.addEventListener('pagehide', saveState);
  window.addEventListener('beforeunload', saveState);

  // 农场点击（事件委托）
  ui.farm.addEventListener('click', (e) => {
    const el = e.target.closest('.plot');
    if (el) onPlotTap(Number(el.dataset.index));
  });
  ui.btnSeeds.addEventListener('click', openSeedShop);
  ui.btnAnimals.addEventListener('click', openAnimalShop);
  ui.btnUpgrades.addEventListener('click', openUpgrades);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-mask').addEventListener('click', closeSheet);

  /* =========================================================
   * 14. 启动
   * ========================================================= */
  function init() {
    const saved = loadState();
    if (saved) {
      state = saved;
    } else {
      state = newState();
      track(EV.IDLE_START, { game: 'idle' }); // 第一次进入
    }
    const awaySec = saved ? (Date.now() - saved.lastSeen) / 1000 : 0;

    buildFarm();
    updateTopbar();
    updateBadges();
    saveState();
    checkOffline(awaySec);
    startTutorial(!saved);
    requestAnimationFrame(frame);

    if (typeof window.showBanner === 'function') window.showBanner('ad-banner');
  }

  init();

  // 调试用：在控制台里可以查看/修改状态，例如 IdleGame.state.coins = 1e6
  window.IdleGame = {
    get state() { return state; },
    save: saveState,
    reset() {
      try {
        localStorage.removeItem(CONFIG.SAVE_KEY);
        localStorage.removeItem(CONFIG.TUTORIAL_KEY);
      } catch (e) { /* 忽略 */ }
      window.removeEventListener('pagehide', saveState);
      window.removeEventListener('beforeunload', saveState);
      location.reload();
    },
    refresh() {
      buildFarm();
      onCoinsChanged();
    },
    fmt: fmt
  };
})();
