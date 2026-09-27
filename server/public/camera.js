import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { PHONEOBS_CONFIG } from './config.js';

const params = new URLSearchParams(location.search);
const pathParts = location.pathname.split('/').filter(Boolean);
const role = params.get('role') || (pathParts[0] === 'view' ? 'receiver' : 'phone');
const slot = Number(params.get('slot') || pathParts[1]);
const session = params.get('session');
const token = params.get('token') || '';
const video = document.querySelector('#preview');
const stateLabel = document.querySelector('#connection-state');
const cameraSelect = document.querySelector('#camera');
const resolutionSelect = document.querySelector('#resolution');
const actualResolution = document.querySelector('#actual-resolution');
const copyViewerButton = document.querySelector('#copy-viewer-link');
const pendingCandidates = [];
let peerConnection;
let mediaStream;
let signalingChannel;
let signalingSocket;
let offerStarted = false;

if (!Number.isInteger(slot) || slot < 1 || slot > 4 || (!session && !token)) {
  stateLabel.textContent = 'Invalid camera slot.';
  throw new Error('Invalid camera slot');
}

document.querySelector('#slot-label').textContent = `CAMERA ${String(slot).padStart(2, '0')}`;
if (role === 'receiver') {
  document.body.classList.add('receiver');
  document.querySelector('#camera-controls').hidden = true;
  video.muted = true;
} else {
  copyViewerButton.addEventListener('click', async () => {
    const viewerUrl = new URL(location.href);
    viewerUrl.searchParams.set('role', 'receiver');
    await navigator.clipboard.writeText(viewerUrl.href);
    copyViewerButton.textContent = 'Viewer link copied';
  });
  await startPhoneCamera();
}

if (role === 'receiver' || mediaStream)
  connectSignaling();

async function startPhoneCamera(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    stateLabel.textContent = 'Camera access requires a trusted HTTPS connection.';
    return;
  }

  try {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = mediaStream;
    await populateCameras();
    await populateResolutions(mediaStream.getVideoTracks()[0]);
    updateActualResolution();
    mediaStream.getVideoTracks()[0].addEventListener('unmute', updateActualResolution);
    stateLabel.textContent = 'Camera ready. Waiting for OBS…';
  } catch (error) {
    stateLabel.textContent = `Could not open camera: ${error.message}`;
  }
}

async function populateCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === 'videoinput');
  cameraSelect.replaceChildren(...devices.map((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    return option;
  }));
  cameraSelect.value = mediaStream?.getVideoTracks()[0]?.getSettings().deviceId || devices[0]?.deviceId || '';
  cameraSelect.disabled = devices.length < 2;
  cameraSelect.onchange = async () => {
    await startPhoneCamera(cameraSelect.value);
    const sender = peerConnection?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender)
      await sender.replaceTrack(mediaStream.getVideoTracks()[0]);
    updateActualResolution();
  };
}

async function populateResolutions(track) {
  const capabilities = track.getCapabilities?.() || {};
  const maxWidth = capabilities.width?.max || 1280;
  const maxHeight = capabilities.height?.max || 720;
  const original = track.getSettings();
  const profiles = [
    { label: 'Auto', width: null, height: null },
    { label: '640 × 480', width: 640, height: 480 },
    { label: '1280 × 720', width: 1280, height: 720 },
    { label: '1920 × 1080', width: 1920, height: 1080 },
    { label: '2560 × 1440', width: 2560, height: 1440 },
    { label: '3840 × 2160', width: 3840, height: 2160 },
  ];
  const supported = [{ label: 'Auto', width: null, height: null }];
  for (const profile of profiles.slice(1)) {
    if (profile.width > maxWidth || profile.height > maxHeight)
      continue;
    try {
      await track.applyConstraints({ width: { exact: profile.width }, height: { exact: profile.height } });
      const settings = track.getSettings();
      if (settings.width === profile.width && settings.height === profile.height)
        supported.push(profile);
    } catch {
      continue;
    }
  }
  if (original.width && original.height) {
    await track.applyConstraints({ width: { ideal: original.width }, height: { ideal: original.height } });
  }
  resolutionSelect.replaceChildren(...supported.map((profile) => {
    const option = document.createElement('option');
    option.textContent = profile.label;
    option.value = profile.width ? `${profile.width}x${profile.height}` : 'auto';
    return option;
  }));
  resolutionSelect.disabled = false;
  resolutionSelect.addEventListener('change', async () => {
    const selected = resolutionSelect.value;
    if (selected === 'auto') {
      await track.applyConstraints({ width: { ideal: maxWidth }, height: { ideal: maxHeight } });
    } else {
      const [width, height] = selected.split('x').map(Number);
      try {
        await track.applyConstraints({ width: { exact: width }, height: { exact: height } });
      } catch {
        stateLabel.textContent = 'That resolution is not available from this camera.';
      }
    }
    updateActualResolution();
  });
}

function updateActualResolution() {
  const settings = mediaStream?.getVideoTracks()[0]?.getSettings();
  if (settings?.width && settings?.height)
    actualResolution.textContent = `Live output: ${settings.width} × ${settings.height}${settings.frameRate ? ` at ${Math.round(settings.frameRate)} fps` : ''}`;
}

async function connectSignaling() {
  if (!session) {
    connectLocalSignaling();
    return;
  }
  if (PHONEOBS_CONFIG.supabaseUrl.includes('YOUR_PROJECT')) {
    stateLabel.textContent = 'Configure Supabase in config.js before connecting.';
    return;
  }
  const supabase = createClient(PHONEOBS_CONFIG.supabaseUrl, PHONEOBS_CONFIG.supabaseAnonKey);
  signalingChannel = supabase.channel(`phoneobs:${session}`, { config: { broadcast: { self: false } } });
  signalingChannel.on('broadcast', { event: 'signal' }, ({ payload }) => handleSignal(payload));
  const result = await new Promise((resolve) => {
    signalingChannel.subscribe((status, error) => resolve({ status, error }));
  });
  if (result.status !== 'SUBSCRIBED') {
    const detail = result.error?.message ? ` ${result.error.message}` : '';
    stateLabel.textContent = `Could not connect to Supabase Realtime.${detail}`;
    setTimeout(() => location.reload(), 5000);
    return;
  }
  stateLabel.textContent = role === 'phone' ? 'Connected securely. Waiting for OBS…' : 'Receiver ready. Waiting for phone…';
  await sendSignal('peer-ready');
}

function connectLocalSignaling() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ slot, role, token });
  signalingSocket = new WebSocket(`${scheme}//${location.host}/signal?${query}`);
  signalingSocket.addEventListener('open', () => {
    stateLabel.textContent = role === 'phone' ? 'Connected securely. Waiting for OBS…' : 'Receiver ready. Waiting for phone…';
  });
  signalingSocket.addEventListener('message', (event) => handleSignal(JSON.parse(event.data)));
  signalingSocket.addEventListener('close', () => {
    stateLabel.textContent = 'Connection closed. Reload this page to reconnect.';
  });
  signalingSocket.addEventListener('error', () => {
    stateLabel.textContent = 'Could not reach the PhoneOBS server.';
  });
}

async function handleSignal(message) {
  if (message.type === 'peer-ready') {
    if (role === 'phone' && !offerStarted && mediaStream) {
      offerStarted = true;
      await startOffer();
    }
    return;
  }
  if (message.type === 'peer-left') {
    peerConnection?.close();
    peerConnection = undefined;
    offerStarted = false;
    video.srcObject = role === 'phone' ? mediaStream : null;
    stateLabel.textContent = role === 'phone' ? 'OBS disconnected. Waiting for OBS…' : 'Phone disconnected.';
    return;
  }
  if (message.type === 'offer') {
    peerConnection = createPeerConnection();
    await peerConnection.setRemoteDescription(message.payload);
    await flushCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendSignal('answer', peerConnection.localDescription);
    stateLabel.textContent = 'Receiving live video…';
    return;
  }
  if (message.type === 'answer' && peerConnection) {
    await peerConnection.setRemoteDescription(message.payload);
    await flushCandidates();
    stateLabel.textContent = 'Live video connected.';
    return;
  }
  if (message.type === 'candidate' && message.payload) {
    if (peerConnection?.remoteDescription)
      await peerConnection.addIceCandidate(message.payload);
    else
      pendingCandidates.push(message.payload);
    return;
  }
  if (message.type === 'error')
    stateLabel.textContent = message.message;
}

async function startOffer() {
  peerConnection = createPeerConnection();
  for (const track of mediaStream.getTracks())
    peerConnection.addTrack(track, mediaStream);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  sendSignal('offer', peerConnection.localDescription);
  stateLabel.textContent = 'Connecting live video to OBS…';
}

function createPeerConnection() {
  const connection = new RTCPeerConnection({ iceServers: [] });
  connection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate)
      sendSignal('candidate', candidate);
  });
  connection.addEventListener('track', ({ streams }) => {
    if (role === 'receiver' && streams[0]) {
      video.srcObject = streams[0];
      stateLabel.textContent = 'Receiving live video…';
    }
  });
  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'connected')
      stateLabel.textContent = 'Live video connected.';
    else if (connection.connectionState === 'failed')
      stateLabel.textContent = 'WebRTC connection failed. Check that both devices are on the same Wi-Fi.';
  });
  return connection;
}

async function flushCandidates() {
  while (pendingCandidates.length)
    await peerConnection.addIceCandidate(pendingCandidates.shift());
}

async function sendSignal(type, payload) {
  if (signalingChannel)
    await signalingChannel.send({ type: 'broadcast', event: 'signal', payload: { type, payload } });
  else if (signalingSocket?.readyState === WebSocket.OPEN)
    signalingSocket.send(JSON.stringify({ type, payload }));
}
