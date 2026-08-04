import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const themePath = resolve("htdocs/luci-static/resources/view/aurora/theme.js");

async function themeSource() {
  return readFile(themePath, "utf8");
}

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${start} exists`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `${end} exists after ${start}`);
  return source.slice(startIndex, endIndex);
}

test("color editor validates only the edited color field", async () => {
  const source = await themeSource();
  const editorBlock = sourceBlock(
    source,
    "const createColorEditor =",
    "const renderColorField =",
  );

  assert.match(editorBlock, /const updateField = \(mode, key, result, options = \{\}\)/);
  assert.match(editorBlock, /const shouldValidate = options\.validateKeys\?\.has\(key\) \?\? false/);
  assert.match(editorBlock, /if \(shouldValidate\) triggerValidation\(field\)/);
  assert.match(editorBlock, /const affectedKeysFor = \(key\) =>/);
  assert.match(editorBlock, /schedule\(mode, token\.key, \{ validate: true \}\)/);
});

test("native color picker does not bubble LuCI change events", async () => {
  const source = await themeSource();
  const pickerBlock = sourceBlock(
    source,
    'picker.addEventListener("change"',
    "editor.register",
  );

  assert.match(pickerBlock, /input\.value = picker\.value/);
  assert.match(pickerBlock, /input\.dispatchEvent\(new Event\("input"\)\)/);
  assert.doesNotMatch(pickerBlock, /new Event\("change"/);
  assert.doesNotMatch(pickerBlock, /bubbles:\s*true/);
});

test("pending color validation keeps the last stable validity", async () => {
  const source = await themeSource();
  const validateBlock = sourceBlock(
    source,
    "const validate = (mode, key, value) =>",
    "const attach =",
  );

  assert.match(
    validateBlock,
    /if \(state\.pending\)\s*return state\.valid \|\| state\.error == null \? true : state\.error/,
  );
});

test("derived color fields can be cleared from UCI", async () => {
  const source = await themeSource();
  const addColorInputsBlock = sourceBlock(
    source,
    "const addColorInputs =",
    "const createColorSections =",
  );

  assert.doesNotMatch(addColorInputsBlock, /if\s*\(\s*token\.derived\s*\)\s*return/);
  assert.doesNotMatch(addColorInputsBlock, /if\s*\(\s*token\.derived\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(
    addColorInputsBlock,
    /if\s*\(\s*trimmed\s*\)[\s\S]*uci\.set[\s\S]*else[\s\S]*uci\.unset/,
  );
  assert.match(addColorInputsBlock, /option\.remove = \(sectionId\) => \{[\s\S]*uci\.unset/);
});

test("saving waits for pending color resolution before writing UCI", async () => {
  const source = await themeSource();
  const editorBlock = sourceBlock(
    source,
    "const createColorEditor =",
    "const renderColorField =",
  );
  const saveBlock = sourceBlock(
    source,
    "const runSavePipeline = function",
    "return view.extend",
  );

  assert.match(editorBlock, /const flush = \(\) => \{/);
  assert.match(editorBlock, /flush,/);
  assert.match(saveBlock, /this\.colorEditor\?\.flush\?\.\(\)/);
  assert.match(saveBlock, /persistDerivedTokens\(this\.colorEditor\)/);
});

test("token groups only collapse via the chevron, not stray header clicks", async () => {
  const source = await themeSource();
  const enhanceBlock = sourceBlock(
    source,
    "const enhanceColorTokenGroups =",
    "const createRangeControlRenderer =",
  );

  // A dedicated chevron button drives the open state explicitly, reusing the
  // theme's navigation chevron glyph.
  assert.match(enhanceBlock, /class: "aurora-token-group-toggle navigation-group-toggle"/);
  assert.match(enhanceBlock, /const setGroupOpen = \(open\) =>/);
  assert.match(
    enhanceBlock,
    /toggle\.addEventListener\("click", \(ev\) => \{[\s\S]*ev\.preventDefault\(\)[\s\S]*ev\.stopPropagation\(\)[\s\S]*setGroupOpen\(!expectedOpen\)/,
  );
  // Any non-chevron summary click is cancelled so the native picker dismiss
  // cannot collapse the group.
  assert.match(
    enhanceBlock,
    /summary\.addEventListener\("click", \(ev\) => \{[\s\S]*aurora-token-group-toggle[\s\S]*ev\.preventDefault\(\)/,
  );
  // A backstop reverts any collapse that still slips through.
  assert.match(
    enhanceBlock,
    /details\.addEventListener\("toggle", \(\) => \{[\s\S]*details\.open = expectedOpen/,
  );
});

test("preset selector moved to the Theme Store; toolbar keeps the config actions", async () => {
  const source = await themeSource();
  // The dropdown and its apply flow now live in gallery.js's Built-in group.
  assert.ok(!source.includes("buildPresetOptions"), "preset dropdown should be gone");
  assert.ok(!source.includes("apply_theme_preset"), "preset apply rpc should be gone from theme.js");
  const toolbarBlock = sourceBlock(
    source,
    "const buildConfigToolbarNode =",
    "const versionArea =",
  );
  // No store link either: the tabmenu already carries that entrance, so a
  // header button would be a second door to the same page.
  assert.ok(
    !/aurora\/gallery|"gallery"/.test(toolbarBlock),
    "the store entrance belongs to the tabmenu, not the toolbar",
  );
  assert.match(toolbarBlock, /exportButton/, "config actions must survive the preset removal");
  assert.match(toolbarBlock, /resetButton/, "reset must survive too");
});

test("derivation falls back to preset colors when a source field is untouched", async () => {
  const source = await themeSource();
  const block = sourceBlock(source, "const sourceValueFor =", "const isDerivedOverride =");
  // uci stores nothing until a colour is edited, so the field is empty and the
  // preset shows as a placeholder. Deriving from input.value alone reported
  // "Unable to generate the automatic derived value." on all 21 derived tokens
  // for every default install.
  assert.match(block, /presetColors\?\.\[colorOptionName\(mode, key\)\]/);
  assert.match(
    block,
    /const value = sourceValueFor\(mode, key\);/,
    "automaticForMode must go through the fallback, not valueFor",
  );
});
