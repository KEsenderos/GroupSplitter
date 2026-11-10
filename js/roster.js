/*
 * roster.js ― 名簿の読み込み（GASとの通信）・名簿の写し・チェックの管理
 * 基づく仕様書：GroupSplitter 仕様書 v0.7
 * 人が行う作業：なし（［設定］タブで名簿のURL・GASのURL・合言葉を入れると、自動で読み込まれる）。
 * 困ったとき：画面の「更新中…」「失敗：…」の理由を見る。仕様書の9-6に理由の一覧がある。
 */
'use strict';

/* GASにPOSTして、返事のJSONを返す。失敗したら理由つきの例外を投げる */
async function postToGas(url, body) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, GAS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e && e.name === 'AbortError' ? '時間切れです（' + (GAS_TIMEOUT_MS / 1000) + '秒）' : '通信できません（電波を確かめてください）');
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error('通信エラー（HTTP ' + res.status + '）');
  let data;
  try { data = JSON.parse(await res.text()); } catch (e) { throw new Error(TEXT.GAS_NOT_JSON); }
  return data;
}

/* GASの返事が失敗のとき、画面に出す文にする */
function gasErrorText(data) {
  if (data && data.code === 'SHEET_NOT_FOUND' && data.message) return TEXT.GAS_ERR.SHEET_NOT_FOUND + '\nGoogleからの理由：' + data.message;
  if (data && data.code && TEXT.GAS_ERR[data.code]) return TEXT.GAS_ERR[data.code];
  return (data && data.message) ? data.message : 'GAS側でエラーが起きました';
}

/* 設定から、GASに送る内容を作る（行番号は空なら送らない） */
function makeRosterRequest(s) {
  const body = { action: 'roster', pass: s.pass, sheetId: s.sheetId };
  if (s.sheetGid) body.gid = s.sheetGid;
  if (s.headingRow) body.headingRow = Number(s.headingRow);
  if (s.memberStartRow) body.memberStartRow = Number(s.memberStartRow);
  if (s.memberEndRow) body.memberEndRow = Number(s.memberEndRow);
  const pc = parseColumns(s.columns);
  if (pc.ok && pc.cols.length) body.columns = pc.cols;
  return body;
}

/* 読み込み条件（名簿・行・列）の目印。変わったら、名簿の写しは古いので読み直す */
function requestSig(s) {
  const b = makeRosterRequest(s);
  delete b.pass;
  return JSON.stringify(b);
}

/* 各人に鍵を付ける。鍵＝グループの見出し|名前|同じグループ内で同じ名前の何番目か（0から） */
function makeKeys(groups) {
  groups.forEach(function (g) {
    var seen = {};
    g.people.forEach(function (p) {
      var n = seen[p.name] || 0;
      seen[p.name] = n + 1;
      p.key = g.title + '|' + p.name + '|' + n;
    });
  });
  return groups;
}

function loadRosterCache() {
  const r = lsGetJson('roster', null);
  return (r && r.v === 1 && Array.isArray(r.groups)) ? r : null;
}
function saveRosterCache(r) { lsSetJson('roster', r); lsSet('rosterAt', r.readAt); }

/* 名簿を読む。force が偽で、前回から5分以内なら読まない */
let rosterBusy = false;
async function fetchRoster(force) {
  const s = App.settings;
  if (!s.sheetId || !s.gasUrl || !s.pass) return { ok: false, skipped: true };
  if (rosterBusy) return { ok: false, skipped: true };
  if (!force) {
    const last = Date.parse(lsGet('rosterAt') || '');
    const sameReq = App.roster && App.roster.reqSig === requestSig(s);
    if (sameReq && !isNaN(last) && Date.now() - last < ROSTER_REFRESH_MIN_INTERVAL_MS) return { ok: false, skipped: true };
  }
  rosterBusy = true;
  App.status = { text: TEXT.LOADING, kind: '' };
  renderRosterStatus();
  try {
    const data = await postToGas(s.gasUrl, makeRosterRequest(s));
    if (!data.ok) throw new Error(gasErrorText(data));
    data.groups = makeKeys(data.groups);
    const r = { v: 1, readAt: data.readAt, sheetName: data.sheetName, headingRow: data.headingRow,
                memberStartRow: data.memberStartRow, groups: data.groups, skipped: data.skipped || [], reqSig: requestSig(s) };
    saveRosterCache(r);
    App.roster = r;
    mergeChecksWithRoster();
    App.status = { text: TEXT.READ_AT(hhmm(r.readAt)), kind: '' };
    renderRosterTab();
    return { ok: true };
  } catch (e) {
    App.status = { text: '失敗：' + e.message, kind: 'error' };
    renderRosterStatus();
    return { ok: false, message: e.message };
  } finally {
    rosterBusy = false;
  }
}

/* ---- チェック ---- */
function loadChecks() { App.checks = lsGetJson('checks', {}) || {}; }
function saveChecks() { lsSetJson('checks', App.checks); }

/* 名簿に無い鍵のチェックを捨てる */
function mergeChecksWithRoster() {
  if (!App.roster) return;
  const keys = {};
  App.roster.groups.forEach(function (g) { g.people.forEach(function (p) { keys[p.key] = true; }); });
  let changed = false;
  Object.keys(App.checks).forEach(function (k) { if (!keys[k]) { delete App.checks[k]; changed = true; } });
  if (changed) saveChecks();
}

/* チェックの変更。role は 'L4' 'L5' 'M' か ''。3つは同時に1つだけ。外れたら番号は0に戻す */
function setRole(key, role) {
  if (!role) { delete App.checks[key]; } else {
    const old = App.checks[key];
    App.checks[key] = { r: role, t: old ? old.t : 0 };
  }
  saveChecks();
}
function setTie(key, t) {
  const c = App.checks[key];
  if (!c) return;
  c.t = Math.max(0, Math.min(MAX_TIE, t | 0));
  saveChecks();
}

/* チェックされた人を、名簿の順（グループの順→行の順）に assign 用の配列にする */
function collectChecked() {
  const out = [];
  if (!App.roster) return out;
  App.roster.groups.forEach(function (g) {
    g.people.forEach(function (p) {
      const c = App.checks[p.key];
      if (c) out.push({ id: p.key, name: p.name, g: g.index, gt: g.title, role: c.r, tie: c.t | 0 });
    });
  });
  return out;
}

function summarize(people) {
  let l4 = 0, l5 = 0, members = 0;
  people.forEach(function (p) { if (p.role === 'L4') l4++; else if (p.role === 'L5') l5++; else members++; });
  const leaders = l4 + l5;
  return { leaders: leaders, l4: l4, l5: l5, members: members,
           seatsBase: 3 * leaders, seatsMax: 3 * l4 + 4 * l5 };
}
