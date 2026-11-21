(() => {
  const byId = id => document.getElementById(id);
  const editor = byId('homepage-editor');
  const preview = byId('homepage-preview');
  const form = byId('homepage-form');
  const fields = byId('homepage-fields');
  const open = byId('edit-homepage');
  const status = byId('homepage-status');
  const textFields = ['PortalHeadline', 'PortalSubheading', 'PortalNotice', 'about'];
  const slots = ['cover', 'gallery1', 'gallery2', 'gallery3'];
  let profile, password, revision, liveRevision, photos, template;
  let ready = false;
  let busy = false;

  window.HomepageEditor = {
    configure(current, enabled, getPassword) {
      profile = current;
      password = getPassword;
      open.hidden = !enabled;
      byId('landing-text-fields').hidden = enabled;
      byId('landing-help').textContent = enabled
        ? 'Edit school photos, welcome information and links. Preview your changes before publishing.'
        : 'Edit the headline and notice shown before a visitor signs in.';
    }
  };
  async function request(action, page) {
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, SettingsScope: 'organisation', password: password(), revision, liveRevision, page }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'Could not update the homepage.');
    return result;
  }
  function lock(value) {
    busy = value;
    fields.disabled = value || !ready;
    for (const id of ['homepage-save', 'homepage-publish', 'homepage-show-preview']) byId(id).disabled = fields.disabled;
    byId('homepage-close').disabled = value;
  }
  async function run(task) {
    if (busy) return;
    lock(true);
    try { await task(); } catch (error) { status.textContent = error.message; }
    finally { lock(false); }
  }
  function inputLabel(parent, title, input) {
    const label = document.createElement('label');
    label.append(title, input);
    parent.append(label);
  }
  function button(label, click) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.onclick = click;
    return node;
  }
  async function resizePhoto(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024)
      throw new Error('Choose a JPG, PNG or WebP photo smaller than 12 MB.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const original = new Image();
      original.src = objectUrl;
      await original.decode();
      const canvas = document.createElement('canvas');
      for (const limit of [1400, 1100, 850, 640, 450]) {
        const scale = Math.min(1, limit / Math.max(original.width, original.height));
        canvas.width = Math.max(1, Math.round(original.width * scale));
        canvas.height = Math.max(1, Math.round(original.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', .8);
        if (image.startsWith('data:image/jpeg;base64,') && image.length <= 170000) return image;
      }
      throw new Error('Choose a smaller photo.');
    } finally { URL.revokeObjectURL(objectUrl); }
  }
  function drawPhotos() {
    const area = byId('homepage-photos');
    area.replaceChildren();
    slots.forEach((slot, index) => {
      const group = document.createElement('fieldset');
      const title = document.createElement('legend');
      title.textContent = index ? 'Gallery photo ' + index : 'Cover photo';
      group.append(title);
      const upload = document.createElement('input');
      upload.type = 'file';
      upload.accept = 'image/png,image/jpeg,image/webp';
      inputLabel(group, 'Choose photo', upload);
      upload.onchange = () => {
        const file = upload.files[0];
        if (file) run(async () => {
          const image = await resizePhoto(file);
          photos[slot] = { image, alt: '', desktopX: 50, desktopY: 50, mobileX: 50, mobileY: 50 };
          drawPhotos();
          status.textContent = 'Photo added. Describe it before publishing.';
        });
      };
      const photo = photos[slot];
      if (photo) {
        const thumb = document.createElement('img');
        thumb.src = photo.image;
        thumb.alt = '';
        group.append(thumb);
        const alt = document.createElement('input');
        alt.maxLength = 200;
        alt.value = photo.alt;
        alt.oninput = () => { photo.alt = alt.value; };
        inputLabel(group, 'Photo description', alt);
        const crops = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Adjust photo crop';
        const positions = document.createElement('div');
        positions.className = 'homepage-crop';
        for (const [name, label] of Object.entries({ desktopX: 'Desktop horizontal', desktopY: 'Desktop vertical',
          mobileX: 'Phone horizontal', mobileY: 'Phone vertical' })) {
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = 0; slider.max = 100; slider.value = photo[name] ?? 50;
          slider.oninput = () => { photo[name] = Number(slider.value); };
          inputLabel(positions, label, slider);
        }
        crops.append(summary, positions);
        group.append(crops, button('Remove photo', () => { delete photos[slot]; drawPhotos(); }));
      }
      area.append(group);
    });
  }
  const links = byId('homepage-link-rows');
  function updateLinks() {
    const groups = Array.from(links.children);
    groups.forEach((group, index) => {
      group.querySelector('legend').textContent = 'Link ' + (index + 1);
      group.querySelector('[data-up]').disabled = index === 0;
      group.querySelector('[data-down]').disabled = index === groups.length - 1;
    });
    byId('homepage-add-link').disabled = groups.length >= 6;
  }
  function addLink(link = {}) {
    if (links.childElementCount >= 6) return;
    const group = document.createElement('fieldset');
    group.append(document.createElement('legend'));
    const label = document.createElement('input');
    label.value = link.label || ''; label.maxLength = 64;
    inputLabel(group, 'Link label', label);
    const url = document.createElement('input');
    url.value = link.url || ''; url.type = 'url'; url.maxLength = 1500; url.placeholder = 'https://';
    inputLabel(group, 'Web address', url);
    const controls = document.createElement('div');
    controls.className = 'homepage-actions';
    const up = button('Move up', () => { links.insertBefore(group, group.previousElementSibling); updateLinks(); });
    const down = button('Move down', () => { links.insertBefore(group.nextElementSibling, group); updateLinks(); });
    up.dataset.up = ''; down.dataset.down = '';
    controls.append(up, down, button('Remove link', () => { group.remove(); updateLinks(); }));
    group.append(controls); links.append(group); updateLinks();
  }
  byId('homepage-add-link').onclick = () => addLink();
  function pageValues() {
    return { ...Object.fromEntries(textFields.map(key => [key, form.elements[key].value])), photos,
      links: Array.from(links.children, group => {
        const [label, url] = group.querySelectorAll('input');
        return { label: label.value, url: url.value };
      }) };
  }
  open.onclick = () => run(async () => {
    ready = false;
    fields.hidden = true;
    editor.showModal();
    status.textContent = 'Loading homepage…';
    const data = await request('loadHomepage');
    revision = data.revision; liveRevision = data.liveRevision;
    const page = data.page || { ...profile, ...data.liveText };
    for (const key of textFields) form.elements[key].value = page[key] || '';
    photos = page.photos || {};
    drawPhotos(); links.replaceChildren();
    (page.links || []).forEach(addLink); updateLinks();
    fields.hidden = false; ready = true;
    status.textContent = '';
  });
  function save(publish) {
    return run(async () => {
      const page = pageValues();
      const result = await request(publish ? 'publishHomepage' : 'saveHomepageDraft', page);
      revision = result.revision; liveRevision = result.liveRevision;
      status.textContent = publish ? 'Homepage published.' : 'Draft saved.';
    });
  }
  byId('homepage-save').onclick = () => save(false);
  form.onsubmit = event => { event.preventDefault(); save(true); };
  byId('homepage-close').onclick = () => editor.close();
  editor.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  editor.addEventListener('close', () => { photos = {}; byId('homepage-photos').replaceChildren(); });
  const frame = preview.querySelector('iframe');
  const screen = byId('homepage-screen');
  screen.onchange = () => { frame.style.width = screen.value + 'px'; };
  byId('homepage-show-preview').onclick = () => run(async () => {
    if (!template) {
      const response = await fetch('/school.html');
      if (!response.ok) throw new Error('Could not load the homepage preview.');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!doc.getElementById('homepage-cover')) throw new Error('The homepage preview is unavailable. Refresh and try again.');
      doc.querySelectorAll('script, link:not([rel="stylesheet"])').forEach(node => node.remove());
      doc.querySelectorAll('[onerror]').forEach(node => node.removeAttribute('onerror'));
      doc.querySelectorAll('a').forEach(node => node.removeAttribute('href'));
      template = '<!doctype html>' + doc.documentElement.outerHTML;
    }
    const page = pageValues();
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc?.querySelector('#homepage-cover')) return;
      for (const [selector, value] of Object.entries({
        '[data-school-name]': profile.SchoolName, '[data-school-address]': profile.SchoolAddress,
        '[data-portal-headline]': page.PortalHeadline, '[data-portal-subheading]': page.PortalSubheading,
        '[data-portal-notice]': page.PortalNotice
      })) {
        const node = doc.querySelector(selector);
        node.textContent = value || ''; node.hidden = !value;
      }
      if (profile.WebLogoUrl) doc.querySelector('.nav-logo').src = profile.WebLogoUrl;
      window.SchoolHomepage.render(doc, page, true);
      doc.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
    };
    screen.onchange();
    frame.srcdoc = template;
    preview.showModal();
  });
  byId('homepage-preview-close').onclick = () => preview.close();
  preview.addEventListener('close', () => { frame.onload = null; frame.removeAttribute('srcdoc'); });
})();
