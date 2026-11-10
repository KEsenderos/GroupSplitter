/*
 * ui-settings.js ― ［設定］タブ（名簿のURL・GASのURL・合言葉・行番号の指定・読み込みテスト）
 * 基づく仕様書：GroupSplitter 仕様書 v0.4
 * 人が行う作業：初めてだけ、3つ（名簿のURL・GASのURL・合言葉）を入れて［保存する］。
 * 困ったとき：［読み込みテスト］の結果の文を見る。
 */
'use strict';

/* 入力欄の今の値を読む（iPhoneでは入力直後に change が起きないことがあるため、押した瞬間に読む） */
function readSettingsForm_() {
  const parsed = parseSheetUrl($('set-sheet-url').value);
  const old = App.settings;
  return {
    parsed: parsed,
    raw: $('set-sheet-url').value.trim(),
    values: {
      sheetId: parsed ? parsed.id : '',
      sheetGid: parsed && parsed.gid ? parsed.gid : '',
      gasUrl: $('set-gas-url').value.trim(),
      pass: $('set-pass').value.trim(),
      headingRow: $('set-heading-row').value.trim(),
      memberStartRow: $('set-member-row').value.trim()
    },
    old: old
  };
}

function setMsg_(text, kind) {
  const m = $('set-msg');
  m.textContent = text;
  m.className = 'msg' + (kind ? ' ' + kind : '');
}

function renderSettingsTab() {
  const s = App.settings;
  $('set-sheet-url').value = '';
  $('set-sheet-url').placeholder = s.sheetId ? '（保存済み。変えるときだけ貼り直す）' : 'スプレッドシートのURLを貼る';
  $('sheet-id-label').textContent = s.sheetId ? 'ID：…' + s.sheetId.slice(-6) + (s.sheetGid ? '　シートgid：' + s.sheetGid : '') : '';
  $('set-gas-url').value = s.gasUrl;
  $('set-pass').value = s.pass;
  $('set-heading-row').value = s.headingRow;
  $('set-member-row').value = s.memberStartRow;
  $('app-version').textContent = 'GroupSplitter v' + APP_VERSION;
}

/* 入力から、検査に使う設定を作る（URL欄が空なら、保存済みの名簿IDを使う） */
function settingsFromForm_() {
  const f = readSettingsForm_();
  const v = f.values;
  if (!f.raw) { v.sheetId = f.old.sheetId; v.sheetGid = f.old.sheetGid; }
  return { f: f, v: v };
}

async function onSaveSettings() {
  const x = settingsFromForm_();
  if (x.f.raw && !x.f.parsed) { setMsg_(TEXT.NOT_URL, 'error'); return; }
  const chk = validateSettings(x.v);
  if (!chk.ok) { setMsg_(chk.errors.join('\n'), 'error'); return; }
  saveSettings(x.v);
  App.settings = loadSettings();
  renderSettingsTab();
  setMsg_('保存しました。名簿を読み込みます…', '');
  const r = await fetchRoster(true);
  setMsg_(r.ok ? '保存しました。名簿を読み込みました' : '保存しました。読み込みは失敗しました：' + (r.message || ''), r.ok ? 'ok' : 'error');
}

async function onTestConnection() {
  const x = settingsFromForm_();
  if (x.f.raw && !x.f.parsed) { setMsg_(TEXT.NOT_URL, 'error'); return; }
  const chk = validateSettings(x.v);
  if (!chk.ok) { setMsg_(chk.errors.join('\n'), 'error'); return; }
  setMsg_('読み込み中…', '');
  try {
    const data = await postToGas(x.v.gasUrl, makeRosterRequest(x.v));
    if (!data.ok) throw new Error(gasErrorText(data));
    const total = data.groups.reduce(function (a, g) { return a + g.people.length; }, 0);
    let text = '読み込めました：' + data.groups.length + 'グループ・' + total + '名／' +
      (data.headingRow ? '見出し' + data.headingRow + '行目・' : '') + 'メンバー' + data.memberStartRow + '行目から';
    if (data.skipped && data.skipped.length) text += '（' + data.skipped.map(function (s) { return s.cell; }).join('、') + 'を飛ばしました）';
    text += '\n' + data.groups.map(function (g) { return g.title + '（' + g.colLetter + '列）' + g.people.length + '名'; }).join('\n');
    setMsg_(text, 'ok');
  } catch (e) {
    setMsg_('失敗：' + e.message, 'error');
  }
}

function onClearRosterCache() {
  if (!confirm('端末に覚えている名簿の写しを消します（チェックは残ります）。よろしいですか？')) return;
  lsRemove('roster');
  lsRemove('rosterAt');
  App.roster = null;
  App.rosterSig = '';
  App.status = { text: '', kind: '' };
  renderRosterTab();
  setMsg_('名簿の写しを消しました', 'ok');
}
