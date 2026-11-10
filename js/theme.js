/*
 * theme.js ― 見た目（自動／ノーマル／ダーク）の決定と切り替え
 * 基づく仕様書：GroupSplitter 仕様書 v1.3
 * 画面が一瞬ちがう色で光らないよう、index.html の <head> の中で最初に読み込む。
 * 見た目の選択は、この端末だけの設定（同期しない）。保存が壊れていたら「自動」として動く。
 */
'use strict';

const THEME_STORAGE_KEY = 'gsp_theme';
const THEME_MODES = ['auto', 'light', 'dark'];
const THEME_COLORS = { light: '#1D4ED8', dark: '#111827' };   // ブラウザ上部の色（theme-color）

/* 選んでいる見た目（auto / light / dark）。読めなければ auto */
function getThemeMode() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.indexOf(v) >= 0 ? v : 'auto';
  } catch (e) { return 'auto'; }
}

/* auto のときは、端末の外観の設定（ダークかどうか）で決める */
function resolveTheme_(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/* 画面に反映する */
function applyTheme(mode) {
  const t = resolveTheme_(mode);
  document.documentElement.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', THEME_COLORS[t]);
}

/* 選んだ見た目を覚えて、すぐ反映する */
function setThemeMode(mode) {
  if (THEME_MODES.indexOf(mode) < 0) mode = 'auto';
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch (e) { /* 保存できなくても反映だけはする */ }
  applyTheme(mode);
}

/* 開いたまま端末の外観が変わっても、auto のときは追いかける */
function initTheme() {
  applyTheme(getThemeMode());
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () { if (getThemeMode() === 'auto') applyTheme('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
}

initTheme();
