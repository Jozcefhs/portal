const setupLoginForm = document.getElementById('setupLoginForm');
const setupForm = document.getElementById('setupForm');
const setupLoginStatus = document.getElementById('setupLoginStatus');
const setupStatus = document.getElementById('setupStatus');
const saveSetupButton = document.getElementById('saveSetupButton');
let unlockedPassword = '';
let webLogoDataUrl = '';
let webLogoChanged = false;

function setStatus(message, type) {
  setupStatus.textContent = message || '';
  setupStatus.className = 'status ' + (type || '');
}

function setLoginStatus(message, type) {
  setupLoginStatus.textContent = message || '';
  setupLoginStatus.className = 'status ' + (type || '');
}

function setField(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value || '';
}

function profileFromForm() {
  const data = new FormData(setupForm);
  const profile = {
    SchoolName: data.get('SchoolName'),
    SchoolCode: data.get('SchoolCode'),
    SchoolAddress: data.get('SchoolAddress'),
    SchoolEmail: data.get('SchoolEmail'),
    SchoolPhone: data.get('SchoolPhone'),
    SchoolSignatoryName: data.get('SchoolSignatoryName'),
    SchoolSignatoryTitle: data.get('SchoolSignatoryTitle'),
    ResultSignatoryName: data.get('ResultSignatoryName'),
    ResultSignatoryTitle: data.get('ResultSignatoryTitle'),
    OfferSignatoryName: data.get('OfferSignatoryName'),
    OfferSignatoryTitle: data.get('OfferSignatoryTitle'),
    AdmissionSignatoryName: data.get('AdmissionSignatoryName'),
    AdmissionSignatoryTitle: data.get('AdmissionSignatoryTitle'),
    EmailGreetingTemplate: data.get('EmailGreetingTemplate'),
    NameFormat: data.get('NameFormat'),
    PortalHeadline: data.get('PortalHeadline'),
    PortalSubheading: data.get('PortalSubheading'),
    PortalNotice: data.get('PortalNotice'),
    ResultDisplayMode: data.get('ResultDisplayMode'),
    ShowResultsOnline: data.get('ShowResultsOnline'),
    ProductKeyMode: data.get('ProductKeyMode')
  };
  if (webLogoChanged) profile.WebLogoDataUrl = webLogoDataUrl;
  return profile;
}

async function loadProfile(password = '') {
  try {
    const response = password
      ? await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'load', password })
        })
      : await fetch('/api/settings');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load setup.');
    const profile = data.profile || {};
    setField('schoolName', profile.SchoolName);
    setField('schoolCode', profile.SchoolCode || 'DCA');
    setField('schoolAddress', profile.SchoolAddress);
    setField('schoolEmail', profile.SchoolEmail);
    setField('schoolPhone', profile.SchoolPhone);
    setField('schoolSignatoryName', profile.SchoolSignatoryName);
    setField('schoolSignatoryTitle', profile.SchoolSignatoryTitle);
    setField('resultSignatoryName', profile.ResultSignatoryName);
    setField('resultSignatoryTitle', profile.ResultSignatoryTitle);
    setField('offerSignatoryName', profile.OfferSignatoryName);
    setField('offerSignatoryTitle', profile.OfferSignatoryTitle);
    setField('admissionSignatoryName', profile.AdmissionSignatoryName);
    setField('admissionSignatoryTitle', profile.AdmissionSignatoryTitle);
    setField('emailGreetingTemplate', profile.EmailGreetingTemplate || 'Dear Parent/Guardian,');
    setField('nameFormat', profile.NameFormat || 'Surname, first name, middle name');
    setField('portalHeadline', profile.PortalHeadline);
    setField('portalSubheading', profile.PortalSubheading);
    setField('portalNotice', profile.PortalNotice);
    webLogoDataUrl = '';
    webLogoChanged = false;
    document.getElementById('webLogoPreview').src = profile.WebLogoUrl || 'images/logo.png';
    setField('resultDisplayMode', profile.ResultDisplayMode || 'subjects');
    setField('showResultsOnline', profile.ShowResultsOnline || 'NO');
    setField('productKeyMode', profile.ProductKeyMode || 'off');
  } catch (error) {
    setStatus(error.message, 'bad');
    throw error;
  }
}

setupLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setLoginStatus('Checking password...', '');
    unlockedPassword = document.getElementById('setupPassword').value;
    await loadProfile(unlockedPassword);
    setupLoginForm.hidden = true;
    setupForm.hidden = false;
    setStatus('Settings loaded and ready to edit.', 'ok');
  } catch (error) {
    unlockedPassword = '';
    setLoginStatus(error.message, 'bad');
  }
});

document.getElementById('webLogoFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    webLogoDataUrl = await resizeLogo(file);
    webLogoChanged = true;
    document.getElementById('webLogoPreview').src = webLogoDataUrl;
    setStatus('Web logo selected. Save Setup to publish it.', 'ok');
  } catch (error) {
    event.target.value = '';
    setStatus(error.message, 'bad');
  }
});

document.getElementById('removeWebLogo').addEventListener('click', () => {
  webLogoDataUrl = '';
  webLogoChanged = true;
  document.getElementById('webLogoFile').value = '';
  document.getElementById('webLogoPreview').src = 'images/logo.png';
  setStatus('Default web logo selected. Save Setup to publish it.', 'ok');
});

function resizeLogo(file) {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose a PNG, JPG, or WebP image.'));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected logo could not be read.'));
    reader.onload = () => { image.src = reader.result; };
    image.onerror = () => reject(new Error('The selected file is not a valid image.'));
    image.onload = () => {
      const scale = Math.min(1, 360 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/png');
      if (result.length > 750000) reject(new Error('The logo is still too large after resizing. Choose a simpler image.'));
      else resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Saving setup...', '');
    saveSetupButton.disabled = true;
    saveSetupButton.textContent = 'Saving...';
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: unlockedPassword,
        profile: profileFromForm()
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Setup could not be saved.');
    setStatus('All changes saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    saveSetupButton.disabled = false;
    saveSetupButton.textContent = 'Save changes';
  }
});

setupForm.addEventListener('input', () => {
  setStatus('You have unsaved changes.', '');
});

const settingsNavLinks = [...document.querySelectorAll('.settings-nav-link')];
settingsNavLinks.forEach((link) => link.addEventListener('click', () => {
  settingsNavLinks.forEach((item) => item.classList.toggle('active', item === link));
}));

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    settingsNavLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
  }, { rootMargin: '-15% 0px -65% 0px', threshold: [0, .2, .5] });
  document.querySelectorAll('.settings-section').forEach((section) => sectionObserver.observe(section));
}

// Public pages can read the school profile, but setup editing stays locked until password entry.
