async function loadSiteProfile() {
  const fallback = {
    SchoolName: 'Integrated School Management Suite',
    SchoolAddress: '',
    PortalHeadline: 'Admissions and parent services in one place',
    PortalSubheading: 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: '',
    NameFormat: 'Surname, first name, middle name',
    ResultDisplayMode: 'subjects',
    ShowResultsOnline: 'NO',
    DeclarationStatement: 'I declare that the information supplied in this application is complete and correct.'
  };
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    return data && data.ok && data.profile ? { ...fallback, ...data.profile } : fallback;
  } catch (_err) {
    return fallback;
  }
}

function applySiteProfile(profile) {
  document.title = document.title.replace('Destiny Christian Academy', profile.SchoolName || 'School Portal');
  document.querySelectorAll('[data-school-name]').forEach((node) => {
    node.textContent = profile.SchoolName || 'School Portal';
  });
  document.querySelectorAll('[data-school-address]').forEach((node) => {
    node.textContent = profile.SchoolAddress || '';
    node.hidden = !profile.SchoolAddress;
  });
  document.querySelectorAll('[data-portal-headline]').forEach((node) => {
    node.textContent = profile.PortalHeadline || '';
  });
  document.querySelectorAll('[data-portal-subheading]').forEach((node) => {
    node.textContent = profile.PortalSubheading || '';
  });
  document.querySelectorAll('[data-portal-notice]').forEach((node) => {
    node.textContent = profile.PortalNotice || '';
    node.hidden = !profile.PortalNotice;
  });
  document.querySelectorAll('[data-declaration-statement]').forEach((node) => {
    node.textContent = profile.DeclarationStatement || 'I declare that the information supplied in this application is complete and correct.';
  });
  if (profile.WebLogoUrl) {
    document.querySelectorAll('img.logo, img.nav-logo').forEach((node) => {
      node.src = profile.WebLogoUrl;
      node.style.display = '';
    });
  }
  window.SCHOOL_PROFILE = profile;
  window.dispatchEvent(new CustomEvent('school-profile-ready', { detail: profile }));
}

window.siteProfileReady = loadSiteProfile().then((profile) => {
  applySiteProfile(profile);
  return profile;
});
