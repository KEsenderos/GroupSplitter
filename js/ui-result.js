/*
 * ui-result.js ― ［結果］タブ（車ごとの一覧・タップでの入れ替え・元に戻す・振り分け直し）
 * 基づく仕様書：GroupSplitter 仕様書 v1.1
 * 人が行う作業：入れ替えたい人を1回タップ→入れ替え先の人をタップ（空き席へは［＋ここへ移す］）。
 */
'use strict';

let noteTimer = null;

function saveResult_() { lsSetJson('result', App.result); }

/* 元に戻す履歴に、今の結果を積む */
function pushUndo_() {
  App.undo.push(JSON.stringify(App.result));
  if (App.undo.length > UNDO_MAX) App.undo.shift();
}

function showResultNote(text) {
  const el = $('result-note');
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(noteTimer);
  if (text) noteTimer = setTimeout(function () { el.hidden = true; }, 5000);
}

function capOf_(car) { return car.type === 5 ? GS_ASSIGN.MAX_MEMBERS.L5 : GS_ASSIGN.MAX_MEMBERS.L4; }

/* 車の名前（ドライバーの名前＋「車」。同じ名前は2つ目以降に（2）を付ける） */
function carNames_(res) {
  const count = {};
  return res.state.cars.map(function (c) {
    const base = res.people[c.leader].n + '車';
    count[base] = (count[base] || 0) + 1;
    return count[base] > 1 ? base + '（' + count[base] + '）' : base;
  });
}

function renderResultTab() {
  const res = App.result;
  const has = !!(res && res.state);
  $('result-empty').hidden = has;
  $('result-toolbar').hidden = !has;
  $('car-list').hidden = !has;
  $('unplaced-card').hidden = !has;
  $('select-hint').hidden = !has || !App.sel;
  if (!has) return;

  const people = res.people;
  const tieOf = {};
  Object.keys(people).forEach(function (id) { tieOf[id] = people[id].t; });
  const broken = {};
  GS_ASSIGN.brokenTies(res.state, tieOf).forEach(function (id) { broken[id] = true; });
  const names = carNames_(res);
  const sel = App.sel;
  let selCar = null;      // 選んでいる人が今いる車（なければ null。席なしは 'unplaced'）
  if (sel) {
    res.state.cars.forEach(function (c, i) { if (c.members.indexOf(sel) >= 0) selCar = i; });
    if (selCar === null) selCar = res.state.unplaced.indexOf(sel) >= 0 ? 'unplaced' : null;
    if (selCar === null) App.sel = null;
  }
  if (App.sel) {
    $('select-hint').firstElementChild.textContent = TEXT.SELECT_HINT(people[App.sel].n);
  }
  $('select-hint').hidden = !App.sel;
  $('undo-btn').disabled = App.undo.length === 0;

  function chip(id, isLeader) {
    const p = people[id];
    const b = h('button', { type: 'button', class: 'person-chip' + (isLeader ? ' leader' : '') + (id === App.sel ? ' selected' : ''), 'data-id': id });
    b.append(groupBadge(p.g));
    b.append(h('span', { class: 'cname' }, p.n));
    if (p.t) b.append(h('span', { class: 'ctie tie-' + p.t }, TIE_MARKS[p.t]));
    if (broken[id]) b.append(h('span', { class: 'warn-mark', title: '一緒に乗る番号の人と別々です' }, '⚠'));
    b.addEventListener('click', function () { onPersonTap(id); });
    return b;
  }

  const list = $('car-list');
  list.textContent = '';
  res.state.cars.forEach(function (c, i) {
    const cap = capOf_(c);
    const card = h('section', { class: 'car-card', 'data-car': String(i) });
    const head = h('h3', { class: 'car-head' }, [names[i] + '　［' + (c.type === 5 ? '乗' : '軽') + '］　' + TEXT.RIDERS + ' ' + c.members.length + '/' + cap]);
    if (c.type === 5 && c.members.length > 3) head.append(h('span', { class: 'fourth' }, ' ' + TEXT.FOURTH));
    card.append(head);
    const lrow = h('div', { class: 'leader-row' }, [h('span', { class: 'leader-label' }, TEXT.LEADER), chip(c.leader, true)]);
    card.append(lrow);
    const mem = h('div', { class: 'members' });
    c.members.forEach(function (id) { mem.append(chip(id, false)); });
    card.append(mem);
    // もとのグループの人数（ドライバーも数える）
    const tally = {};
    [c.leader].concat(c.members).forEach(function (id) { const g = people[id].g; tally[g] = (tally[g] || 0) + 1; });
    const t = h('div', { class: 'tally' }, [TEXT.ORIGIN_GROUP + ' ']);
    Object.keys(tally).sort(function (a, b) { return a - b; }).forEach(function (g) {
      t.append(groupBadge(Number(g)), '×' + tally[g] + ' ');
    });
    card.append(t);
    if (App.sel && selCar !== i && c.members.length < cap) {
      const sb = h('button', { type: 'button', class: 'slot-btn', 'data-target': String(i) }, TEXT.MOVE_HERE);
      sb.addEventListener('click', function () { onSlotTap(i); });
      card.append(sb);
    }
    list.append(card);
  });

  const un = $('unplaced-card');
  un.textContent = '';
  un.append(h('h3', { class: 'car-head' }, TEXT.UNPLACED + '（' + res.state.unplaced.length + '名）'));
  const um = h('div', { class: 'members' });
  res.state.unplaced.forEach(function (id) { um.append(chip(id, false)); });
  un.append(um);
  if (App.sel && selCar !== 'unplaced') {
    const sb = h('button', { type: 'button', class: 'slot-btn', 'data-target': 'unplaced' }, TEXT.MOVE_UNPLACED);
    sb.addEventListener('click', function () { onSlotTap('unplaced'); });
    un.append(sb);
  }
}

/* 人をタップ */
function onPersonTap(id) {
  const res = App.result;
  if (!res) return;
  if (res.state.cars.some(function (c) { return c.leader === id; })) { showResultNote(TEXT.LEADER_FIXED); return; }
  if (!App.sel) { App.sel = id; }
  else if (App.sel === id) { App.sel = null; }
  else {
    const r = GS_ASSIGN.swapPeople(res.state, App.sel, id);
    if (r.ok) {
      pushUndo_();
      res.state = r.state;
      saveResult_();
    }
    App.sel = null;
  }
  showResultNote('');
  renderResultTab();
}

/* ［＋ここへ移す］［＋席なしへ移す］ */
function onSlotTap(target) {
  const res = App.result;
  if (!res || !App.sel) return;
  const r = GS_ASSIGN.movePerson(res.state, App.sel, target);
  if (r.ok) {
    pushUndo_();
    res.state = r.state;
    saveResult_();
  } else if (r.code === 'FULL') {
    showResultNote('この車は満席です');
  }
  App.sel = null;
  renderResultTab();
}

function onCancelSelect() { App.sel = null; renderResultTab(); }

/* ［元に戻す］ */
function onUndo() {
  if (!App.undo.length) return;
  App.result = JSON.parse(App.undo.pop());
  App.sel = null;
  saveResult_();
  showResultNote('');
  renderResultTab();
}

/* ［振り分け直す］：保存してある人の情報から、新しい種で振り分けをやり直す */
function onReshuffle() {
  const res = App.result;
  if (!res) return;
  App.sel = null;
  const people = Object.keys(res.people).map(function (id) {
    const p = res.people[id];
    return { id: id, name: p.n, g: p.g, role: p.r, tie: p.t };
  });
  const seed = (Date.now() ^ Math.floor(Math.random() * 2147483648)) >>> 0;
  const r = GS_ASSIGN.assign(people, seed);
  if (!r.ok) { showResultNote(r.message); renderResultTab(); return; }
  pushUndo_();
  res.seed = seed;
  res.at = new Date().toISOString();
  res.state = { cars: r.cars, unplaced: r.unplaced };
  saveResult_();
  showResultNote('');
  renderResultTab();
}
