/*
 * assign.js ― GroupSplitter の振り分けの計算（画面にもGASにも依存しない部品）
 * 基づく仕様書：GroupSplitter 仕様書 v0.5
 * 入力が同じ（人の一覧と seed が同じ）なら、結果も必ず同じになる。
 */
var GS_ASSIGN = (function () {
  'use strict';

  var BASE_MEMBERS = 3;               // 1台の基本の同乗人数（リーダーを除く）
  var MAX_MEMBERS = { L4: 3, L5: 4 }; // 1台に乗れる最大の同乗人数
  var TRIES = 60;                     // 乱数を変えて試す回数
  var TIE_MARKS = ['', '❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾'];

  // 種つきの乱数（mulberry32）。0以上1未満の数を返す関数を作る
  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 配列をかき混ぜた新しい配列を返す（Fisher-Yates）
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fail(code, message, detail) {
    return { ok: false, code: code, message: message, detail: detail || {} };
  }

  function nameOf(p) { return p.name || p.id; }

  /*
   * assign(people, seed)
   *   people: [{ id, name?, g, role: 'L4'|'L5'|'M', tie: 0〜9 }]（チェックされた人だけ。並びは表の順）
   *     g    ＝もとのグループの番号（1から）
   *     role ＝ L4：車4のリーダー／L5：車5のリーダー／M：参加
   *     tie  ＝一緒に乗る番号（0＝なし）
   *   戻り値：{ ok:true, cars:[{ leader, type, members:[id…] }], unplaced:[id…], score }
   *           か { ok:false, code, message, detail }
   */
  function assign(people, seed) {
    var P = people.map(function (p, i) {
      return { id: p.id, name: p.name, g: p.g, role: p.role, tie: p.tie | 0, i: i };
    });
    if (P.length === 0) return fail('NOTHING_CHECKED', 'チェックされた人がいません');

    var leaders = P.filter(function (p) { return p.role !== 'M'; });
    var members = P.filter(function (p) { return p.role === 'M'; });
    if (leaders.length === 0) return fail('NO_LEADER', '車4・車5にチェックした人がいません');

    var cars = leaders.map(function (p, k) {
      return { k: k, leader: p, type: p.role === 'L5' ? 5 : 4,
               cap: p.role === 'L5' ? MAX_MEMBERS.L5 : MAX_MEMBERS.L4, pinned: [] };
    });
    var maxCap = 0;
    cars.forEach(function (c) { if (c.cap > maxCap) maxCap = c.cap; });

    // 一緒に乗る番号ごとにまとめる
    var tieCars = {}, tieMem = {};
    cars.forEach(function (c) {
      var t = c.leader.tie;
      if (t > 0) (tieCars[t] = tieCars[t] || []).push(c);
    });
    members.forEach(function (p) {
      if (p.tie > 0) (tieMem[p.tie] = tieMem[p.tie] || []).push(p);
    });

    var blocks = [];              // リーダーのいない、2人以上の番号のまとまり
    var singles = [];             // 1人ずつ置く人
    var tied = {};                // 番号つきで singles 以外になった人の id
    for (var t = 1; t <= 9; t++) {
      var L = tieCars[t] || [], M = tieMem[t] || [];
      if (L.length >= 2) {
        return fail('TIE_TWO_LEADERS',
          TIE_MARKS[t] + 'のリーダーが' + L.length + '人います（' +
          L.map(function (c) { return nameOf(c.leader); }).join('、') + '）。リーダーは別々の車に乗るため、同じ番号にできません',
          { tie: t, leaders: L.map(function (c) { return c.leader.id; }) });
      }
      if (L.length === 1) {
        if (M.length > L[0].cap) {
          return fail('TIE_TOO_BIG',
            TIE_MARKS[t] + 'の人は' + (M.length + 1) + '人（リーダー' + nameOf(L[0].leader) + 'を含む）ですが、その車は車' +
            L[0].type + 'で同乗は' + L[0].cap + '人までです',
            { tie: t, size: M.length, cap: L[0].cap });
        }
        M.forEach(function (p) { L[0].pinned.push(p); tied[p.id] = true; });
      } else if (M.length > maxCap) {
        return fail('TIE_TOO_BIG',
          TIE_MARKS[t] + 'の人が' + M.length + '人います。1台に乗れるのは最大' + maxCap + '人です',
          { tie: t, size: M.length, cap: maxCap });
      } else if (M.length >= 2) {
        blocks.push({ tie: t, members: M, size: M.length });
        M.forEach(function (p) { tied[p.id] = true; });
      }
    }
    members.forEach(function (p) { if (!tied[p.id]) singles.push(p); });

    // 全員の中のグループ別の割合（グループの均等さを測るため）
    var gTotal = {};
    P.forEach(function (p) { gTotal[p.g] = (gTotal[p.g] || 0) + 1; });

    var rnd = mulberry32(seed);
    var best = null;

    for (var attemptNo = 0; attemptNo < TRIES; attemptNo++) {
      var res = attempt_(rnd);
      if (res === null) {
        return fail('TIE_NO_FIT', '一緒に乗る番号の人たちを、車に入れる組み合わせが見つかりません。番号の人数か車の台数を見直してください', {});
      }
      if (best === null || better_(res.score, best.score)) best = res;
    }
    return {
      ok: true,
      cars: best.cars.map(function (c) {
        return { leader: c.leader.id, type: c.type,
                 members: c.mem.slice().sort(byIndex_).map(function (p) { return p.id; }) };
      }),
      unplaced: best.unplaced.slice().sort(byIndex_).map(function (p) { return p.id; }),
      score: best.score
    };

    function byIndex_(a, b) { return a.i - b.i; }

    function better_(a, b) {
      for (var i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i];
      }
      return false;
    }

    // 1回分の試み。ブロックを置けなければ null
    function attempt_(rnd) {
      var st = cars.map(function (c) {
        var s = { c: c, load: c.pinned.length, cap: c.cap, mem: c.pinned.slice(), gc: {} };
        s.gc[c.leader.g] = 1;
        c.pinned.forEach(function (p) { s.gc[p.g] = (s.gc[p.g] || 0) + 1; });
        return s;
      });

      // ① 番号のまとまり（大きいものから）
      var order = blocks.map(function (b) { return { b: b, r: rnd() }; })
        .sort(function (x, y) { return (y.b.size - x.b.size) || (x.r - y.r); })
        .map(function (x) { return x.b; });
      if (!placeBlock_(0)) return null;

      function placeBlock_(bi) {
        if (bi === order.length) return true;
        var b = order[bi], seen = {}, cand = [];
        st.forEach(function (s, idx) {
          if (s.load + b.size > s.cap) return;
          var key = s.load + ':' + s.cap;       // 同じ状態の車は1台だけ試す（結果は同じため）
          var item = { idx: idx, over: (s.load + b.size > BASE_MEMBERS) ? 1 : 0, load: s.load, r: rnd() };
          if (!seen[key]) { seen[key] = item; cand.push(item); }
          else if (item.r < seen[key].r) { cand[cand.indexOf(seen[key])] = item; seen[key] = item; }
        });
        cand.sort(function (x, y) { return (x.over - y.over) || (x.load - y.load) || (x.r - y.r); });
        for (var k = 0; k < cand.length; k++) {
          var s = st[cand[k].idx];
          b.members.forEach(function (p) { s.mem.push(p); s.gc[p.g] = (s.gc[p.g] || 0) + 1; });
          s.load += b.size;
          if (placeBlock_(bi + 1)) return true;
          s.load -= b.size;
          b.members.forEach(function (p) { s.mem.pop(); s.gc[p.g] -= 1; });
        }
        return false;
      }

      // ② 1人ずつ。グループを交互に並べて、人数が少ない車・同じグループが少ない車へ
      var byG = {};
      singles.forEach(function (p) { (byG[p.g] = byG[p.g] || []).push(p); });
      var gKeys = shuffle(Object.keys(byG), rnd);
      var lists = gKeys.map(function (g) { return shuffle(byG[g], rnd); });
      var seq = [];
      var more = true;
      while (more) {
        more = false;
        lists.forEach(function (l) { if (l.length) { seq.push(l.shift()); more = true; } });
      }
      var unplaced = [];
      seq.forEach(function (p) {
        var bestIdx = -1, bestKey = null;
        st.forEach(function (s, idx) {
          if (s.load >= s.cap) return;
          var key = [(s.load + 1 > BASE_MEMBERS) ? 1 : 0, s.load, s.gc[p.g] || 0, rnd()];
          if (bestKey === null || lexLess_(key, bestKey)) { bestKey = key; bestIdx = idx; }
        });
        if (bestIdx < 0) { unplaced.push(p); return; }
        var s = st[bestIdx];
        s.mem.push(p); s.load += 1; s.gc[p.g] = (s.gc[p.g] || 0) + 1;
      });

      // ③ 点数（小さいほどよい）：席なしの人数／4人目の車の数／人数のばらつき／グループのばらつき
      var over = 0, sq = 0, gimb = 0;
      st.forEach(function (s) {
        if (s.load > BASE_MEMBERS) over++;
        sq += s.load * s.load;
        var tot = s.load + 1;
        Object.keys(gTotal).forEach(function (g) {
          var exp = tot * gTotal[g] / P.length;
          var d = (s.gc[g] || 0) - exp;
          gimb += d * d;
        });
      });
      return { cars: st.map(function (s) { return { leader: s.c.leader, type: s.c.type, mem: s.mem }; }),
               unplaced: unplaced, score: [unplaced.length, over, sq, gimb] };
    }

    function lexLess_(a, b) {
      for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
      }
      return false;
    }
  }

  /* ---- 手動の調整（状態を直接変えず、新しい状態を返す） ---- */
  // state: { cars:[{leader, type, members:[id…]}], unplaced:[id…] }
  function cloneState(state) {
    return { cars: state.cars.map(function (c) { return { leader: c.leader, type: c.type, members: c.members.slice() }; }),
             unplaced: state.unplaced.slice() };
  }
  function locate_(state, id) {
    for (var i = 0; i < state.cars.length; i++) {
      if (state.cars[i].leader === id) return { kind: 'leader', car: i };
      var k = state.cars[i].members.indexOf(id);
      if (k >= 0) return { kind: 'member', car: i, pos: k };
    }
    var u = state.unplaced.indexOf(id);
    if (u >= 0) return { kind: 'unplaced', pos: u };
    return null;
  }
  // 2人の入れ替え。リーダーは動かせない
  function swapPeople(state, idA, idB) {
    var a = locate_(state, idA), b = locate_(state, idB);
    if (!a || !b) return { ok: false, code: 'NOT_FOUND' };
    if (a.kind === 'leader' || b.kind === 'leader') return { ok: false, code: 'LEADER_FIXED' };
    if (idA === idB) return { ok: false, code: 'SAME' };
    var s = cloneState(state);
    function put(loc, id) {
      if (loc.kind === 'member') s.cars[loc.car].members[loc.pos] = id;
      else s.unplaced[loc.pos] = id;
    }
    put(a, idB); put(b, idA);
    return { ok: true, state: s };
  }
  // 1人の移動。to は車の番号（0から）か 'unplaced'。定員を超えるときは断る
  function movePerson(state, id, to) {
    var a = locate_(state, id);
    if (!a) return { ok: false, code: 'NOT_FOUND' };
    if (a.kind === 'leader') return { ok: false, code: 'LEADER_FIXED' };
    var s = cloneState(state);
    if (to === 'unplaced') {
      if (a.kind === 'unplaced') return { ok: false, code: 'SAME' };
      s.cars[a.car].members.splice(a.pos, 1);
      s.unplaced.push(id);
      return { ok: true, state: s };
    }
    if (a.kind === 'member' && a.car === to) return { ok: false, code: 'SAME' };
    var cap = MAX_MEMBERS[s.cars[to].type === 5 ? 'L5' : 'L4'];
    if (s.cars[to].members.length >= cap) return { ok: false, code: 'FULL', cap: cap };
    if (a.kind === 'member') s.cars[a.car].members.splice(a.pos, 1); else s.unplaced.splice(a.pos, 1);
    s.cars[to].members.push(id);
    return { ok: true, state: s };
  }
  // 一緒に乗る番号が別々の場所になっている人の id の一覧（⚠を出す人）
  // tieOf: id → 番号（0〜9）。場所は「車の番号」か 'unplaced'
  function brokenTies(state, tieOf) {
    var where = {};
    state.cars.forEach(function (c, i) {
      where[c.leader] = i;
      c.members.forEach(function (m) { where[m] = i; });
    });
    state.unplaced.forEach(function (m) { where[m] = 'unplaced'; });
    var first = {}, broken = {};
    Object.keys(where).forEach(function (id) {
      var t = tieOf[id] | 0;
      if (t > 0) { (first[t] = first[t] || {})[where[id]] = true; }
    });
    var out = [];
    Object.keys(where).forEach(function (id) {
      var t = tieOf[id] | 0;
      if (t > 0 && Object.keys(first[t]).length > 1) out.push(id);
    });
    return out;
  }

  return {
    TRIES: TRIES, BASE_MEMBERS: BASE_MEMBERS, MAX_MEMBERS: MAX_MEMBERS, TIE_MARKS: TIE_MARKS,
    mulberry32: mulberry32, assign: assign,
    swapPeople: swapPeople, movePerson: movePerson, brokenTies: brokenTies
  };
})();

if (typeof module !== 'undefined') module.exports = GS_ASSIGN;
