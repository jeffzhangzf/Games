/* =========================================================
 * idle/data.js — 挂机农场的数值配置（作物、动物、升级）
 *
 * 用途：所有影响游戏平衡的数字都在这里。
 *       想调数值只改这个文件，idle.js 只读取这里的配置，不写死任何价格和时间。
 *
 * 对外（项目不用构建工具，所以挂在全局上）：
 *   window.IdleData = { START_COINS, START_PLOTS, MAX_PLOTS, OFFLINE_BASE_RATE,
 *                       OFFLINE_MIN_SECONDS, OFFLINE_MAX_HOURS, ANIMAL_MAX_STOCK,
 *                       ANIMAL_SELL_REFUND, crops, animals, upgrades }
 *
 * 数值目标：
 *   - 10 秒内完成第一次收获（小麦 5 秒成熟）
 *   - 不会卡死：小麦种子免费，玩家把钱花光了也能继续种、继续赚
 *   - 前 5 分钟能买到第 2 种作物（胡萝卜）
 *   - 前 30 分钟能解锁第一种动物（小鸡）
 *   - 越往后的作物每块地每秒赚得越多，但长得更慢、解锁贵得多 —— 节奏逐渐变慢
 * ========================================================= */

(function () {
  'use strict';

  /* ---------------- 全局设置 ---------------- */

  var START_COINS = 10;          // 开局零花钱（小麦免费，这点钱只是让开局宽裕一点）
  var START_PLOTS = 4;           // 开局地块数
  var MAX_PLOTS = 20;            // 地块上限（START_PLOTS + "扩建农场"满级）
  var OFFLINE_BASE_RATE = 0.2;   // 离线收益 = 每秒收益 × 20%（升级前）
  var OFFLINE_MIN_SECONDS = 60;  // 离开超过 60 秒才算离线、弹"欢迎回来"
  var OFFLINE_MAX_HOURS = 8;     // 离线收益最多按 8 小时算
  var ANIMAL_MAX_STOCK = 3;      // 动物产出攒到 3 个就暂停，等玩家来收
  var ANIMAL_SELL_REFUND = 0.5;  // 卖掉动物退还购买价的 50%（腾出地块种别的）

  /* ---------------- 作物 ----------------
   * id          唯一标识（存档和埋点里用）
   * name        显示名称
   * emoji       地块上显示的图标
   * growTime    从种下到成熟的秒数
   * seedCost    每种一次要花的种子钱
   * sellPrice   每次收获卖出的金币
   * unlockCost  在商店解锁这种种子的一次性费用（0 = 开局就有）
   *
   * 每块地每秒净赚 = (sellPrice - seedCost) / growTime
   * -------------------------------------- */
  var crops = [
    { id: 'wheat',      name: 'Wheat',      emoji: '🌾', growTime: 5,    seedCost: 0,     sellPrice: 3,     unlockCost: 0 },
    { id: 'carrot',     name: 'Carrot',     emoji: '🥕', growTime: 15,   seedCost: 8,     sellPrice: 30,    unlockCost: 150 },
    { id: 'corn',       name: 'Corn',       emoji: '🌽', growTime: 45,   seedCost: 40,    sellPrice: 150,   unlockCost: 1500 },
    { id: 'tomato',     name: 'Tomato',     emoji: '🍅', growTime: 120,  seedCost: 150,   sellPrice: 600,   unlockCost: 8000 },
    { id: 'pumpkin',    name: 'Pumpkin',    emoji: '🎃', growTime: 300,  seedCost: 600,   sellPrice: 2600,  unlockCost: 40000 },
    { id: 'strawberry', name: 'Strawberry', emoji: '🍓', growTime: 600,  seedCost: 2500,  sellPrice: 11000, unlockCost: 200000 },
    { id: 'sunflower',  name: 'Sunflower',  emoji: '🌻', growTime: 1800, seedCost: 15000, sellPrice: 70000, unlockCost: 1500000 }
  ];

  /* ---------------- 动物 ----------------
   * 动物放在地块上（和作物抢地方），自己定时产出东西。
   * id            唯一标识
   * name          显示名称
   * emoji         动物图标
   * product       产出物图标（攒着的时候显示在动物旁边）
   * produceTime   产出一个要多少秒
   * produceValue  每个产出值多少金币
   * unlockCost    在商店解锁这种动物的一次性费用
   * buyCost       每放一只到农场里要花的钱
   *
   * 每只每秒收入 = produceValue / produceTime
   * 攒满 ANIMAL_MAX_STOCK 个后暂停产出。
   * -------------------------------------- */
  var animals = [
    { id: 'chicken', name: 'Chicken', emoji: '🐔', product: '🥚', produceTime: 20,  produceValue: 25,   unlockCost: 2000,    buyCost: 500 },
    { id: 'cow',     name: 'Cow',     emoji: '🐄', product: '🥛', produceTime: 60,  produceValue: 200,  unlockCost: 25000,   buyCost: 5000 },
    { id: 'sheep',   name: 'Sheep',   emoji: '🐑', product: '🧶', produceTime: 120, produceValue: 900,  unlockCost: 150000,  buyCost: 30000 },
    { id: 'bee',     name: 'Bee',     emoji: '🐝', product: '🍯', produceTime: 300, produceValue: 5000, unlockCost: 1000000, buyCost: 200000 }
  ];

  /* ---------------- 升级 ----------------
   * id              唯一标识
   * name            显示名称
   * description     商店里的一句话说明（口语化）
   * baseCost        1 级的价格
   * costMultiplier  第 N 级价格 = baseCost × costMultiplier^(N-1)
   * maxLevel        最高等级
   * effect          { type, perLevel }，idle.js 按 type 计算效果：
   *   growSpeed     作物生长时间 × (1 - perLevel)^等级      （每级快 10%）
   *   cropValue     作物售价 × (1 + perLevel × 等级)
   *   animalValue   动物产出价值 × (1 + perLevel × 等级)
   *   plots         地块数 = START_PLOTS + perLevel × 等级
   *   offlineRate   离线比例 = OFFLINE_BASE_RATE + perLevel × 等级
   * -------------------------------------- */
  var upgrades = [
    {
      id: 'fertilizer',
      name: 'Fertilizer',
      description: 'Crops grow 10% faster. Who doesn\'t like faster?',
      baseCost: 100,
      costMultiplier: 2.2,
      maxLevel: 10,
      effect: { type: 'growSpeed', perLevel: 0.1 }
    },
    {
      id: 'market',
      name: 'Farmers Market',
      description: 'Crops sell for 10% more. Haggling pro.',
      baseCost: 500,
      costMultiplier: 2.3,
      maxLevel: 10,
      effect: { type: 'cropValue', perLevel: 0.1 }
    },
    {
      id: 'feed',
      name: 'Premium Feed',
      description: 'Well-fed animals produce 25% more.',
      baseCost: 3000,
      costMultiplier: 2.5,
      maxLevel: 10,
      effect: { type: 'animalValue', perLevel: 0.25 }
    },
    {
      id: 'land',
      name: 'Expand Farm',
      description: 'Clear new land for 2 more plots.',
      baseCost: 250,
      costMultiplier: 2.8,
      maxLevel: 8,
      effect: { type: 'plots', perLevel: 2 }
    },
    {
      id: 'farmhand',
      name: 'Hire a Farmhand',
      description: '+10% offline earnings. They work, you sleep.',
      baseCost: 1000,
      costMultiplier: 3,
      maxLevel: 6,
      effect: { type: 'offlineRate', perLevel: 0.1 }
    }
  ];

  var IdleData = {
    START_COINS: START_COINS,
    START_PLOTS: START_PLOTS,
    MAX_PLOTS: MAX_PLOTS,
    OFFLINE_BASE_RATE: OFFLINE_BASE_RATE,
    OFFLINE_MIN_SECONDS: OFFLINE_MIN_SECONDS,
    OFFLINE_MAX_HOURS: OFFLINE_MAX_HOURS,
    ANIMAL_MAX_STOCK: ANIMAL_MAX_STOCK,
    ANIMAL_SELL_REFUND: ANIMAL_SELL_REFUND,
    crops: crops,
    animals: animals,
    upgrades: upgrades
  };

  if (typeof window !== 'undefined') window.IdleData = IdleData;
  // 也支持在 Node 里加载，用来跑数值模拟（浏览器里不起作用）
  if (typeof module !== 'undefined' && module.exports) module.exports = IdleData;
})();
