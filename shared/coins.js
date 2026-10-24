/* =========================================================
 * shared/coins.js — site-wide coin wallet
 * One coin balance shared by every game on the site (localStorage),
 * kept in sync across open tabs.
 *
 *   Coins.get()            current balance (integer >= 0)
 *   Coins.add(n)           add n coins (negative to spend); returns new balance
 *   Coins.onChange(fn)     fn(balance) after any change, also from other tabs
 *
 * localStorage key: site_coins
 * ========================================================= */
(function () {
  'use strict';

  var KEY = 'site_coins';
  var listeners = [];

  function get() {
    try {
      var n = parseInt(localStorage.getItem(KEY), 10);
      return n > 0 ? n : 0;
    } catch (e) {
      return 0; // private mode etc.
    }
  }

  function notify() {
    var n = get();
    listeners.forEach(function (fn) { fn(n); });
  }

  function add(n) {
    var next = Math.max(0, get() + Math.round(n || 0));
    try {
      localStorage.setItem(KEY, String(next));
    } catch (e) { /* ignore */ }
    notify();
    return next;
  }

  // Another tab changed the balance
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) notify();
  });

  window.Coins = {
    get: get,
    add: add,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
