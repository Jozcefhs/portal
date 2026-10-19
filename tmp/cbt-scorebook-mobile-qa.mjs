import {chromium} from 'file:///C:/Users/DYNAMAX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const css=await readFile('css/style.css','utf8');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 for(const width of [360,390,700,1280]){
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.setContent(`<style>${css}</style><main style="padding:12px"><div class="table-wrap academic-scorebook-table"><table><thead><tr><th class="academic-serial">S/N</th><th class="academic-student-cell">Student</th>${Array.from({length:8},(_,i)=>`<th>Assessment ${i+1}</th>`).join('')}</tr></thead><tbody><tr><td class="academic-serial">1</td><td class="academic-student-cell">Sample student with a longer name</td>${Array.from({length:8},(_,i)=>`<td><input aria-label="Score ${i+1}" type="number" value="50"></td>`).join('')}</tr></tbody></table></div></main>`);
  const positions=await page.evaluate(()=>{
   const wrap=document.querySelector('.academic-scorebook-table'),name=document.querySelector('td.academic-student-cell'),input=document.querySelector('input');
   const before=name.getBoundingClientRect().left;
   wrap.scrollLeft=260;
   return {before,after:name.getBoundingClientRect().left,scroll:wrap.scrollLeft,position:getComputedStyle(name).position,input:input.getBoundingClientRect().left,right:wrap.getBoundingClientRect().right};
  });
  if(width<=700){assert.ok(positions.scroll>0);assert.equal(positions.position,'static');assert.ok(positions.after<positions.before-200);assert.ok(positions.input<positions.right);}
  else assert.equal(positions.position,'sticky');
  await page.getByRole('spinbutton',{name:'Score 4',exact:true}).fill('75');
  assert.equal(await page.getByRole('spinbutton',{name:'Score 4',exact:true}).inputValue(),'75');
  await page.screenshot({path:`tmp/cbt-scorebook-${width}.png`});
  console.log(`PASS ${width}px: score fields reachable and editable`);await page.close();
 }
} finally {await browser.close();}
