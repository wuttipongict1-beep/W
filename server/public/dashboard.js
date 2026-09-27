const slotsElement = document.querySelector('#slots');
const notice = document.querySelector('#notice');
const baseUrl = new URL('./camera.html', location.href);
const sessions = JSON.parse(localStorage.getItem('phoneobs-sessions') || '{}');

function sessionFor(slot) {
  if (!sessions[slot]) {
    sessions[slot] = crypto.randomUUID();
    localStorage.setItem('phoneobs-sessions', JSON.stringify(sessions));
  }
  return sessions[slot];
}

function cameraUrl(slot) {
  const url = new URL(baseUrl);
  url.searchParams.set('slot', slot);
  url.searchParams.set('role', 'phone');
  url.searchParams.set('session', sessionFor(slot));
  return url.href;
}

function viewerUrl(slot) {
  const url = new URL(cameraUrl(slot));
  url.searchParams.set('role', 'receiver');
  return url.href;
}

function makeLink(label, href) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  link.target = '_blank';
  link.rel = 'noreferrer';
  return link;
}

for (const slot of [1, 2, 3, 4]) {
  const card = document.createElement('article');
  card.className = 'slot';
  const heading = document.createElement('h2');
  heading.textContent = `Phone ${String(slot).padStart(2, '0')}`;
  const phoneLink = makeLink('Open camera on phone', cameraUrl(slot));
  const viewer = viewerUrl(slot);
  const viewerLink = makeLink('Open viewer', viewer);
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy viewer link';
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(viewer);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy viewer link'; }, 1500);
  });
  card.append(heading, phoneLink, viewerLink, copyButton);
  slotsElement.append(card);
}

if (!window.isSecureContext)
  notice.textContent = 'GitHub Pages must be opened over HTTPS for camera access.';
else
  notice.hidden = true;
