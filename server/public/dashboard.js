const slotsElement = document.querySelector('#slots');
const notice = document.querySelector('#notice');
const sessions = JSON.parse(localStorage.getItem('phoneobs-vdo-rooms') || '{}');

function sessionFor(slot) {
  if (!sessions[slot]) {
    sessions[slot] = crypto.randomUUID();
    localStorage.setItem('phoneobs-vdo-rooms', JSON.stringify(sessions));
  }
  return sessions[slot];
}

function cameraUrl(slot) {
  return `https://vdo.ninja/?push=${encodeURIComponent(sessionFor(slot))}&webcam=1`;
}

function viewerUrl(slot) {
  return `https://vdo.ninja/?view=${encodeURIComponent(sessionFor(slot))}&cleanoutput=1`;
}

function makeLink(label, href) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  link.target = '_blank';
  link.rel = 'noreferrer';
  return link;
}

function makeCopyButton(label, href) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(href);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 1500);
  });
  return button;
}

for (const slot of [1, 2, 3, 4]) {
  const card = document.createElement('article');
  card.className = 'slot';
  const heading = document.createElement('h2');
  heading.textContent = `Phone ${String(slot).padStart(2, '0')}`;
  const phoneLink = makeLink('Open camera on phone', cameraUrl(slot));
  const viewer = viewerUrl(slot);
  const viewerLink = makeLink('Open viewer', viewer);
  card.append(heading, phoneLink, makeCopyButton('Copy camera link', cameraUrl(slot)), viewerLink, makeCopyButton('Copy viewer link', viewer));
  slotsElement.append(card);
}

if (!window.isSecureContext)
  notice.textContent = 'GitHub Pages must be opened over HTTPS for camera access.';
else
  notice.hidden = true;
