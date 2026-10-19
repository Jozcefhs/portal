import { readFile, writeFile } from 'node:fs/promises';
const html = await readFile('setup.html', 'utf8');
const js = await readFile('js/setup.js', 'utf8');
const card = html.slice(html.indexOf('            <div class="settings-field full-width paystack-connection-card"'), html.indexOf('            <div class="settings-field', html.indexOf('id="checkPaystackActivation"')));
const ui = js.slice(js.indexOf('function paystackConfigured()'), js.indexOf('function setEmailProviderStatus'));
const handlers = js.slice(js.indexOf("connectPaystackButton?.addEventListener('click'"), js.indexOf("document.getElementById('copyPaystackWebhook')?.addEventListener"));
const fields = ['paystackSecretKeyField:paystackSecretKey', 'confirmPaystackReplacement:confirmPaystackReplacement', 'connectPaystackButton:connectPaystackButton', 'paystackConnectionStatus:paystackConnectionStatus', 'checkPaystackActivationButton:checkPaystackActivation', 'settingsScopeField:settingsScope', 'settingsBranchField:settingsBranch'];
await writeFile('tmp/paystack-activation-qa.html', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"></head><body style="padding:24px"><main style="max-width:1050px;margin:auto"><h1>Organisation payments — local test</h1><p>Simulated credentials only. No payment or external request is made.</p><form id="setupForm"><input id="settingsScope" value="organisation" hidden><input id="settingsBranch" value="" hidden><label>Unsaved organisation name<input id="draftName" value="My unsaved draft"></label>${card}</form><p id="qaStatus"></p><button id="saveTest">Save settings</button><button id="activateTest">Simulate deployment activation</button></main><script src="/js/paystack-connection-status.js"></script><script src="/js/action-feedback.js"></script><script>
${fields.map(value => { const [name, id] = value.split(':'); return `const ${name}=document.getElementById('${id}');`; }).join('\n')}
let paystackConnectionMode='not-configured', paystackWorkspaceId='', paystackActivationTracker=null, paystackSelfServiceAvailable=false, unlockedPassword='fixture-only';
const fingerprint='live:'+'a'.repeat(24);
const profile=()=>({WorkspaceId:'qa-school',PaystackConnectionMode:sessionStorage.qaActive==='true'?'live':'test',PaystackCredentialFingerprint:sessionStorage.qaActive==='true'?fingerprint:'test:'+'b'.repeat(24),PaystackSelfServiceAvailable:true});
function setStatus(message){document.getElementById('qaStatus').textContent=message;}
window.fetch=async function(url){return {ok:true,json:async()=>url==='/api/paystack-connection'?{ok:true,mode:'live',activeMode:profile().PaystackConnectionMode,credentialFingerprint:fingerprint,deploymentQueued:true}:{ok:true,profile:profile()}};};
${ui}
${handlers}
document.getElementById('saveTest').onclick=()=>{updatePaystackConnectionUI(profile());setStatus('Settings saved; deployment still reports '+profile().PaystackConnectionMode+'.');};
document.getElementById('activateTest').onclick=()=>{sessionStorage.qaActive='true';setStatus('Simulated runtime changed. Click Check activation.');};
updatePaystackConnectionUI(profile());
</script></body></html>`.replace('<head>', '<head><meta charset="utf-8">'));
