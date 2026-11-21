(() => {
  function render(doc, details = {}, preview = false) {
    const cover = doc.querySelector('#homepage-cover');
    if (!cover) return;
    const picture = (slot) => {
      const photo = details.photos?.[slot];
      if (!photo) return null;
      const image = doc.createElement('img');
      if (preview && photo.image?.startsWith('data:image/jpeg;base64,')) image.src = photo.image;
      else if (/^[a-f0-9]{64}$/.test(photo.hash)) image.src = '/api/settings?homepagePhoto=' + slot + '&v=' + photo.hash;
      else return null;
      image.alt = photo.alt || '';
      image.decoding = 'async';
      if (slot !== 'cover') image.loading = 'lazy';
      for (const name of ['desktopX', 'desktopY', 'mobileX', 'mobileY']) {
        const point = Number(photo[name] ?? 50);
        image.style.setProperty('--' + name, (Number.isFinite(point) ? Math.max(0, Math.min(100, point)) : 50) + '%');
      }
      return image;
    };
    const image = picture('cover');
    cover.replaceChildren(...(image ? [image] : []));
    cover.hidden = !image;
    doc.querySelector('.hero-service-panel').hidden = Boolean(image);
    const about = doc.querySelector('#homepage-about');
    about.querySelector('p').textContent = details.about || '';
    about.hidden = !details.about;
    const links = doc.querySelector('#homepage-links');
    const list = links.querySelector('ul');
    list.replaceChildren();
    for (const link of details.links || []) {
      let url;
      try { url = new URL(link.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password || !link.label) continue;
      const item = doc.createElement('li');
      const anchor = doc.createElement('a');
      anchor.href = url.href;
      anchor.textContent = link.label;
      item.append(anchor);
      list.append(item);
    }
    links.hidden = !list.childElementCount;
    const gallery = doc.querySelector('#homepage-gallery');
    const images = ['gallery1', 'gallery2', 'gallery3'].map(picture).filter(Boolean);
    gallery.querySelector('div').replaceChildren(...images);
    gallery.hidden = !images.length;
  }
  window.SchoolHomepage = { render };
  window.addEventListener('school-profile-ready', event => render(document, event.detail?.SchoolHomepage));
})();
