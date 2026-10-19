import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';


const registrationSource = fs.readFileSync(new URL('../js/register-organization.js', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');


test('recommended plan badge participates in card layout instead of covering the title', () => {
  assert.match(
    registrationSource,
    /<span class="plan-choice-main">\$\{recommended[\s\S]*?plan-choice-tag[\s\S]*?<strong>/
  );
  assert.match(styleSource, /\.plan-choice-tag\s*\{[^}]*position:\s*static/);
  assert.match(styleSource, /\.plan-choice-tag\s*\{[^}]*align-self:\s*flex-start/);
});
