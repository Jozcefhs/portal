import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portalCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('shared summary-card rows scroll horizontally instead of compressing or wrapping', () => {
  const sharedRowRule = /\.metric-row,\s*\.workflow-kpis,\s*\.commerce-summary-grid,\s*\.records-desk-metrics,\s*\.student-conduct-summary\{([\s\S]*?)\}/;
  const match = portalCss.match(sharedRowRule);

  assert.ok(match, 'expected a shared summary-card row rule');
  assert.match(match[1], /display:flex/);
  assert.match(match[1], /flex-wrap:nowrap/);
  assert.match(match[1], /width:100%/);
  assert.match(match[1], /max-width:100%/);
  assert.match(match[1], /min-width:0/);
  assert.match(match[1], /overflow-x:auto/);
  assert.match(match[1], /overflow-y:hidden/);
  assert.match(match[1], /overscroll-behavior-x:contain/);
  assert.match(match[1], /scroll-snap-type:x proximity/);
  assert.match(match[1], /touch-action:pan-x pan-y/);
  assert.match(match[1], /-webkit-overflow-scrolling:touch/);
});

test('summary cards retain a readable basis and snap within their own row', () => {
  const sharedCardRule = /\.metric-row>div,\s*\.workflow-kpis>div,\s*\.commerce-summary-grid>div,\s*\.records-desk-metrics>div,\s*\.student-conduct-summary>div\{([\s\S]*?)\}/;
  const match = portalCss.match(sharedCardRule);

  assert.ok(match, 'expected a shared summary-card sizing rule');
  assert.match(match[1], /flex:1 0 var\(--summary-card-basis\)/);
  assert.match(match[1], /min-width:var\(--summary-card-basis\)/);
  assert.match(match[1], /scroll-snap-align:start/);
  assert.match(portalCss, /\.workflow-kpis\{--summary-card-basis:clamp\(165px,19vw,220px\)\}/);
  assert.match(portalCss, /\.records-desk-metrics\{--summary-card-basis:clamp\(135px,15vw,180px\)\}/);
});

test('parent credit guidance remains below its four summary cards', () => {
  assert.match(
    portalCss,
    /\.metric-row:has\(>\.credit-note\)\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:repeat\(4,minmax\(var\(--summary-card-basis\),1fr\)\)/,
  );
  assert.match(portalCss, /\.metric-row:has\(>\.credit-note\)>\.credit-note\{grid-column:1\/-1\}/);
});

test('scrollable summary rows expose a keyboard focus treatment', () => {
  assert.match(
    portalCss,
    /\.metric-row:focus-visible,\s*\.workflow-kpis:focus-visible,\s*\.commerce-summary-grid:focus-visible,\s*\.records-desk-metrics:focus-visible,\s*\.student-conduct-summary:focus-visible\{[\s\S]*?outline:2px solid var\(--blue\)/,
  );
});
