/*
 * app.js ― 起動・タブの切り替え・更新ボタン
 * 基づく仕様書：GroupSplitter 仕様書 v0.7
 * 困ったとき：画面が古いままなら、上に出る紫の更新ボタンを押す。出ないときは10分ほど待ってアプリを開き直す。
 */
'use strict';

let swRegistration = null;
let lastUpdateCheck = 0;
let updateRequested = false;   // ボタンが押されたときだけ true（初回の起動で読み込み直さないため）

function switchTab(tabId) {
  App.tab = tabId;
  ['roster', 'result', 'settings'].forEach(function (id) {
    $('panel-' + id).hidden = id !== tabId;
  });
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    const on = b.getAttribute('data-tab') === tabId;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  $('action-bar').hidden = tabId !== 'roster';
  lsSet('lastTab', tabId);
  if (tabId === 'result') renderResultTab();
  if (tabId === 'roster') renderRosterTab();
  if (tabId === 'settings') renderSettingsTab();
  window.scrollTo(0, 0);
}

function initApp() {
  App.settings = loadSettings();
  App.roster = loadRosterCache();
  loadChecks();
  App.result = lsGetJson('result', null);
  if (App.roster) App.status = { text: TEXT.READ_AT(hhmm(App.roster.readAt)), kind: '' };

  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });
  $('roster-refresh-btn').addEventListener('click', function () { fetchRoster(true); });
  $('assign-btn').addEventListener('click', onAssignClick);
  $('clear-checks-btn').addEventListener('click', onClearChecks);
  $('clear-undo-btn').addEventListener('click', onUndoClearChecks);
  $('undo-btn').addEventListener('click', onUndo);
  $('reshuffle-btn').addEventListener('click', onReshuffle);
  $('cancel-select-btn').addEventListener('click', onCancelSelect);
  $('goto-roster-btn').addEventListener('click', function () { switchTab('roster'); });
  $('set-save-btn').addEventListener('click', onSaveSettings);
  $('test-btn').addEventListener('click', onTestConnection);
  $('clear-cache-btn').addEventListener('click', onClearRosterCache);
  document.querySelectorAll('.theme-btn').forEach(function (b) {
    b.addEventListener('click', function () { onThemeButton(b.getAttribute('data-theme-mode')); });
  });

  let first = lsGet('lastTab');
  if (['roster', 'result', 'settings'].indexOf(first) < 0) first = null;
  if (!first) first = (App.settings.sheetId && App.roster) ? 'roster' : 'settings';
  switchTab(first);

  initUpdateNotice();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') onVisible();
  });
  onVisible();
}

/* 前面に戻ったとき：更新の確認と、名簿の読み直し */
function onVisible() {
  checkForUpdate();
  fetchRoster(false);
}

/* ---- 更新ボタン（ルールブック3-12のとおり） ---- */
async function initUpdateNotice() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
  } catch (e) { return; }
  lastUpdateCheck = Date.now();
  if (swRegistration.waiting && navigator.serviceWorker.controller) showUpdateButton();
  swRegistration.addEventListener('updatefound', function () {
    const worker = swRegistration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateButton();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  $('update-btn').addEventListener('click', applyUpdate);
}

function checkForUpdate() {
  if (!swRegistration) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  swRegistration.update().catch(function () {});
}

function showUpdateButton() { $('update-btn').hidden = false; }

function applyUpdate() {
  $('update-btn').hidden = true;
  const waiting = swRegistration && swRegistration.waiting;
  if (waiting) {
    updateRequested = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    location.reload();
  }
}

window.addEventListener('DOMContentLoaded', initApp);
