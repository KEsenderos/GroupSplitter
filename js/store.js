/*
 * store.js ― GroupSplitter の共通部品（定数・文言・端末への保存・URLの解析・画面を作る小道具）
 * 基づく仕様書：GroupSplitter 仕様書 v1.3
 * 困ったとき：画面の［設定］タブの文言は TEXT にまとめてある。
 */
'use strict';

const APP_VERSION = '1.3';
const CACHE_VERSION = 'groupsplitter-cache-v1.3';
const STORAGE_PREFIX = 'gsp_';
const TIE_MARKS = ['', '❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '歩き'];   // 添字10＝歩き
const MAX_TIE = 9;
const WALK_TIE = 10;   // 「歩き」の番号（車に乗らない人。assign.js の WALK_TIE と同じ）
const ROSTER_REFRESH_MIN_INTERVAL_MS = 300000;
const GAS_TIMEOUT_MS = 30000;
const UNDO_MAX = 30;
const UPDATE_CHECK_INTERVAL_MS = 600000;
const MAX_PEOPLE = 300;
const MAX_GROUPS = 12;
const MIN_PASS_LENGTH = 24;
const ROLE = { L4: 'L4', L5: 'L5', M: 'M' };
const DEFAULT_COLUMNS = 'F,I,L,O';      // 読み込む列の初期値（設定で変えられる）
const DEFAULT_START_ROW = '7';          // メンバーの先頭の行の初期値（設定で変えられる）

const TEXT = {
  NEED_SETTINGS: '名簿を読み込んでください（［設定］タブ）',
  NEED_CHECK: 'ドライバーと参加者にチェックを付けてください',
  NEED_LEADER: '乗か軽にチェックしたドライバーが必要です',
  ERR_NOTHING_CHECKED: 'チェックされた人がいません',
  ERR_NO_LEADER: '乗か軽にチェックしたドライバーがいません',
  SHORT_SEATS: (n) => '席が足りません。' + n + '名は『席なし』になります',
  ASSIGN: '振り分ける',
  RESHUFFLE: '振り分け直す',
  UNDO: '元に戻す',
  CANCEL_SELECT: '選択をやめる',
  MOVE_HERE: '＋ここへ移す',
  MOVE_UNPLACED: '＋席なしへ移す',
  LEADER_FIXED: 'ドライバーは動かせません',
  WALK_FIXED: '歩きの人は結果では動かせません（名簿の［番号］を変えて、振り分け直してください）',
  WALK: '歩き',
  UNPLACED: '席なし',
  LEADER: 'ドライバー',
  RIDERS: '同乗',
  FOURTH: '4人目あり',
  ORIGIN_GROUP: 'もとのグループ',
  LOADING: '更新中…',
  READ_AT: (t) => t + 'に読み込み',
  SKIPPED: (cells) => '文字ではないセルを飛ばしました：' + cells,
  CLEARED: 'リセットしました',
  FOLD_SHOW: '表示',
  FOLD_HIDE: '非表示',
  UPDATE_AVAILABLE: '新しい版があります。押すと更新します',
  NO_RESULT: 'まだ振り分けていません。［名簿］タブでチェックを付けて［振り分ける］を押してください',
  SELECT_HINT: (n) => n + 'さんを選びました。入れ替える人をタップ、または車の［＋ここへ移す］をタップ',
  NOT_URL: 'スプレッドシートのURLではありません',
  STORAGE_WARN: 'この端末では保存が使えないため、アプリを閉じると設定とチェックが消えます',
  GAS_NOT_JSON: 'GASのURLが正しいか、デプロイの『アクセスできるユーザー』が『全員』になっているか確かめてください',
  GAS_ERR: {
    BAD_PASS: '合言葉が違います',
    NOT_SETUP: 'GAS側の準備（setup）が終わっていません',
    NOT_ALLOWED: 'このスプレッドシートは、GASの許可リストにありません',
    SHEET_NOT_FOUND: 'スプレッドシートを開けません（URLの間違い、またはGASを動かすGoogleアカウントに共有されていません）',
    NO_LIST: '名簿の表で、番号つきのメンバー一覧（1・2・3…）が見つかりません。［設定］の「メンバーの先頭の行」を指定してください',
    NO_GROUP: 'メンバーの先頭の行から下に、名前の入った列が見つかりません。行番号の指定を確かめてください',
    TOO_MANY: '名簿が大きすぎます（' + MAX_PEOPLE + '名・' + MAX_GROUPS + 'グループまで）',
    BAD_REQUEST: '送った内容に誤りがあります',
    SERVER_ERROR: 'GAS側でエラーが起きました'
  }
};

/* ---- アプリ全体の状態（画面を閉じると消えるもの＋端末から読んだもの） ---- */
const App = {
  settings: null,      // loadSettings() の結果
  roster: null,        // 名簿の写し（7-1）
  checks: {},          // { 鍵: { r, t } }
  result: null,        // 最後の振り分け結果（7-3）
  undo: [],            // 元に戻す履歴（結果のJSON文字）。メモリの中だけ
  sel: null,           // 結果の画面で選んでいる人の鍵
  status: { text: '', kind: '' },
  rowEls: {},          // 鍵 → 名簿の行の部品
  rosterSig: '',
  tab: 'roster'
};

/* ---- 端末への保存（使えないときは開いている間だけ覚える） ---- */
let storageOk = true;
const memStore = {};
function lsGet(k) {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + k);
    return v === null ? (k in memStore ? memStore[k] : null) : v;
  } catch (e) { storageOk = false; return k in memStore ? memStore[k] : null; }
}
function lsSet(k, v) {
  memStore[k] = v;
  try { localStorage.setItem(STORAGE_PREFIX + k, v); } catch (e) { storageOk = false; }
}
function lsRemove(k) {
  delete memStore[k];
  try { localStorage.removeItem(STORAGE_PREFIX + k); } catch (e) { storageOk = false; }
}
function lsGetJson(k, fallback) {
  const s = lsGet(k);
  if (s === null) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}
function lsSetJson(k, v) { lsSet(k, JSON.stringify(v)); }

/* ---- 設定 ---- */
function loadSettings() {
  // 列・先頭の行は、一度も保存していなければ初期値。空欄で保存した場合は「自動」（空のまま）
  const cols = lsGet('columns');
  const start = lsGet('memberStartRow');
  return {
    sheetId: lsGet('sheetId') || '',
    sheetGid: lsGet('sheetGid') || '',
    gasUrl: lsGet('gasUrl') || '',
    pass: lsGet('pass') || '',
    headingRow: lsGet('headingRow') || '',
    memberStartRow: start === null ? DEFAULT_START_ROW : start,
    memberEndRow: lsGet('memberEndRow') || '',
    columns: cols === null ? DEFAULT_COLUMNS : cols
  };
}
function saveSettings(o) {
  ['sheetId', 'sheetGid', 'gasUrl', 'pass', 'headingRow', 'memberEndRow'].forEach(function (k) {
    if (o[k] === '' || o[k] === null || o[k] === undefined) lsRemove(k); else lsSet(k, String(o[k]));
  });
  lsSet('memberStartRow', String(o.memberStartRow || ''));
  lsSet('columns', String(o.columns || ''));
}

/* 「F,I,L,O」のような入力を、列の文字の配列にする。戻り値 { ok, cols } か { ok:false, error } */
function parseColumns(text) {
  const parts = String(text || '').normalize('NFKC').toUpperCase().split(/[\s,、，・]+/).filter(function (s) { return s !== ''; });
  const cols = [];
  for (let i = 0; i < parts.length; i++) {
    if (!/^[A-Z]{1,2}$/.test(parts[i])) return { ok: false, error: '読み込む列は「F,I,L,O」のように、列の文字（A〜ZZ）をカンマで区切って入れてください' };
    if (cols.indexOf(parts[i]) < 0) cols.push(parts[i]);
  }
  if (cols.length > MAX_GROUPS) return { ok: false, error: '読み込む列は' + MAX_GROUPS + '個までです' };
  return { ok: true, cols: cols };
}
function isRowNumber_(s) { return s === '' || (/^\d{1,3}$/.test(s) && Number(s) >= 1 && Number(s) <= 200); }
function validateSettings(o) {
  const errors = [];
  if (!o.sheetId) errors.push('名簿のURLを入れてください');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(o.gasUrl || '')) {
    errors.push('GASのURLは https://script.google.com/macros/s/…/exec の形で入れてください');
  }
  if (!o.pass || o.pass.length < MIN_PASS_LENGTH || /\s/.test(o.pass)) {
    errors.push('合言葉は' + MIN_PASS_LENGTH + '文字以上で、空白なしで入れてください');
  }
  if (!isRowNumber_(o.headingRow || '')) errors.push('見出しの行は1〜200の数字か、空欄にしてください');
  if (!isRowNumber_(o.memberStartRow || '')) errors.push('メンバーの先頭の行は1〜200の数字か、空欄にしてください');
  if (!/^\d{0,4}$/.test(o.memberEndRow || '') || (o.memberEndRow && (Number(o.memberEndRow) < 1 || Number(o.memberEndRow) > 1000))) errors.push('メンバーの最後の行は1〜1000の数字か、空欄にしてください');
  else if (o.memberEndRow && o.memberStartRow && Number(o.memberEndRow) < Number(o.memberStartRow)) errors.push('メンバーの最後の行は、先頭の行と同じかそれより下にしてください');
  const pc = parseColumns(o.columns || '');
  if (!pc.ok) errors.push(pc.error);
  return { ok: errors.length === 0, errors: errors };
}

/* ---- 貼られた文字から、スプレッドシートの ID と シートの gid を取り出す ---- */
function parseSheetUrl(text) {
  var s = String(text || '').trim();
  var m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
  var id = m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null);
  if (!id) return null;
  var g = /[#&?]gid=(\d+)/.exec(s);
  return { id: id, gid: g ? g[1] : null };
}

/* ---- 画面を作る小道具（文字は textContent で入れる＝HTMLとして解釈させない） ---- */
function $(id) { return document.getElementById(id); }
function h(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
  });
  (children === undefined ? [] : [].concat(children)).forEach(function (c) {
    if (c === null || c === undefined) return;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
function groupClass(g) { return 'g' + (((g - 1) % 4) + 1); }
function groupBadge(g) { return h('span', { class: 'gbadge ' + groupClass(g), 'aria-label': 'グループ' + g }, String(g)); }
function hhmm(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
