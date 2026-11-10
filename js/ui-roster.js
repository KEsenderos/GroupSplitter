/*
 * ui-roster.js ― ［名簿］タブ（名簿の表示・チェック・［振り分ける］）
 * 基づく仕様書：GroupSplitter 仕様書 v1.1
 * 人が行う作業：参加する人にチェックを付けて［振り分ける］を押す。
 */
'use strict';

let clearNoteTimer = null;

/* 名簿の状態の表示（「14:50に読み込み」「失敗：…」） */
function renderRosterStatus() {
  const el = $('roster-status');
  el.textContent = App.status.text;
  el.className = 'status' + (App.status.kind === 'error' ? ' error' : '');
}

/* ［名簿］タブ全体を描く */
function renderRosterTab() {
  renderRosterStatus();
  const notes = $('roster-notes');
  notes.textContent = '';
  if (App.roster && App.roster.skipped && App.roster.skipped.length) {
    notes.textContent = TEXT.SKIPPED(App.roster.skipped.map(function (s) { return s.cell; }).join('、'));
  }
  if (!storageOk) notes.textContent += (notes.textContent ? '　' : '') + TEXT.STORAGE_WARN;
  renderRosterRows();
  renderActionBar();
}

/* 名簿の行を作る。名簿の中身が変わったときだけ作り直す（番号の選択欄を開いている最中に閉じないため） */
function renderRosterRows() {
  const box = $('roster-groups');
  const r = App.roster;
  const sig = r ? JSON.stringify(r.groups.map(function (g) { return [g.title, g.people.map(function (p) { return p.key + '#' + p.row; })]; })) : '';
  if (sig === App.rosterSig && box.childNodes.length) {
    Object.keys(App.rowEls).forEach(updateRowState);
    return;
  }
  App.rosterSig = sig;
  App.rowEls = {};
  box.textContent = '';
  if (!r) {
    box.append(h('p', { class: 'empty' }, TEXT.NEED_SETTINGS));
    return;
  }
  r.groups.forEach(function (g) {
    const block = h('section', { class: 'group-block', 'data-group': String(g.index) });
    block.append(h('h2', { class: 'group-title' }, [groupBadge(g.index), ' ' + g.title + '（' + g.people.length + '名）']));
    block.append(h('div', { class: 'col-head' }, [
      h('span', { class: 'row-no' }),
      h('span', { class: 'ch' }, '乗'), h('span', { class: 'ch' }, '軽'),
      h('span', { class: 'pname' }),
      h('span', { class: 'ch' }, '参加'), h('span', { class: 'ch tie' }, '番号')
    ]));
    g.people.forEach(function (p) {
      const row = h('div', { class: 'person-row', 'data-key': p.key });
      row.append(h('span', { class: 'row-no' }, p.label === null || p.label === undefined ? '' : String(p.label)));
      /* 並び：行番号｜乗｜軽｜名前｜参加｜番号。乗・軽を付けると参加も付く／どれかを外すと両方外れる／参加だけなら乗・軽は付けない（9-4） */
      function addCheck(cls, label, valueFn) {
        const input = h('input', { type: 'checkbox', class: cls, 'aria-label': p.name + ' ' + label });
        input.addEventListener('change', function () { onRoleChange(p.key, valueFn(input.checked)); });
        row.append(h('label', { class: 'chk' }, input));
      }
      addCheck('chk-l5', '乗', function (on) { return on ? 'L5' : ''; });
      addCheck('chk-l4', '軽', function (on) { return on ? 'L4' : ''; });
      row.append(h('span', { class: 'pname' }, p.name));
      addCheck('chk-m', '参加', function (on) { return on ? 'M' : ''; });
      const sel = h('select', { class: 'tie-select', 'aria-label': p.name + ' 一緒に乗る番号' });
      for (let t = 0; t <= MAX_TIE; t++) sel.append(h('option', { value: String(t) }, t === 0 ? '－' : TIE_MARKS[t]));
      sel.addEventListener('change', function () { paintTie_(sel); onTieChange(p.key, Number(sel.value)); });
      row.append(sel);
      block.append(row);
      App.rowEls[p.key] = row;
    });
    box.append(block);
  });
  Object.keys(App.rowEls).forEach(updateRowState);
}

/* 1人分の行の見た目（チェック・背景・番号）だけを更新する */
function updateRowState(key) {
  const row = App.rowEls[key];
  if (!row) return;
  const c = App.checks[key];
  const role = c ? c.r : '';
  row.querySelector('.chk-l4').checked = role === 'L4';
  row.querySelector('.chk-l5').checked = role === 'L5';
  row.querySelector('.chk-m').checked = role !== '';   /* 乗・軽のときも参加は付く */
  row.classList.toggle('is-leader', role === 'L4' || role === 'L5');
  row.classList.toggle('is-member', role === 'M');
  const sel = row.querySelector('.tie-select');
  sel.disabled = !role;
  sel.value = String(c ? c.t : 0);
  paintTie_(sel);
}

/* 番号の色：select に tie-1〜tie-9 を付け外しする（0＝色なし） */
function paintTie_(sel) {
  for (let t = 1; t <= MAX_TIE; t++) sel.classList.remove('tie-' + t);
  if (Number(sel.value) > 0) sel.classList.add('tie-' + Number(sel.value));
}

function onRoleChange(key, role) {
  setRole(key, role);
  updateRowState(key);
  renderActionBar();
}
function onTieChange(key, t) {
  setTie(key, t);
  updateRowState(key);
  renderActionBar();
}

/* 画面下の操作バー（要約・理由・ボタン）を更新する */
function renderActionBar() {
  const people = collectChecked();
  const s = summarize(people);
  const btn = $('assign-btn');
  const summary = $('action-summary');
  let can = true;
  let text;
  if (!App.roster) { can = false; text = TEXT.NEED_SETTINGS; }
  else if (people.length === 0) { can = false; text = TEXT.NEED_CHECK; }
  else if (s.leaders === 0) { can = false; text = TEXT.NEED_LEADER; }
  else {
    text = 'ドライバー' + s.leaders + '名(乗×' + s.l5 + '・軽×' + s.l4 + ')・参加' + s.members + '名・席' +
      (s.seatsBase === s.seatsMax ? s.seatsBase : s.seatsBase + '〜' + s.seatsMax);
  }
  summary.textContent = text;
  $('action-warn').textContent = (can && s.members > s.seatsMax) ? TEXT.SHORT_SEATS(s.members - s.seatsMax) : '';
  btn.disabled = !can;
  $('clear-checks-btn').disabled = Object.keys(App.checks).length === 0;
  $('action-error').textContent = '';
}

/* ［振り分ける］ */
function onAssignClick() {
  const people = collectChecked();
  const seed = (Date.now() ^ Math.floor(Math.random() * 2147483648)) >>> 0;
  const r = GS_ASSIGN.assign(people.map(function (p) { return { id: p.id, name: p.name, g: p.g, role: p.role, tie: p.tie }; }), seed);
  if (!r.ok) {
    $('action-error').textContent = TEXT['ERR_' + r.code] || r.message;
    return;
  }
  const pmap = {};
  people.forEach(function (p) { pmap[p.id] = { n: p.name, g: p.g, gt: p.gt, t: p.tie, r: p.role }; });
  App.result = { v: 1, seed: seed, at: new Date().toISOString(), people: pmap,
                 state: { cars: r.cars, unplaced: r.unplaced } };
  saveResult_();
  App.undo = [];
  App.sel = null;
  switchTab('result');
}

/* ［チェックをすべて外す］（確認画面は出さず、5秒間［元に戻す］を出す） */
function onClearChecks() {
  if (!Object.keys(App.checks).length) return;
  lsSetJson('prevChecks', App.checks);
  App.checks = {};
  saveChecks();
  Object.keys(App.rowEls).forEach(updateRowState);
  renderActionBar();
  const note = $('clear-note');
  note.hidden = false;
  clearTimeout(clearNoteTimer);
  clearNoteTimer = setTimeout(function () { note.hidden = true; }, 5000);
}
function onUndoClearChecks() {
  const prev = lsGetJson('prevChecks', null);
  if (prev) {
    App.checks = prev;
    saveChecks();
    mergeChecksWithRoster();
    Object.keys(App.rowEls).forEach(updateRowState);
    renderActionBar();
  }
  $('clear-note').hidden = true;
}
