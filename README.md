# PhoneOBS

PhoneOBS is a Windows OBS plugin and local WebRTC signaling service for up to four phone cameras. Video only is sent; the phone requests camera access with `audio: false`. The OBS source renders the receiver page using OBS Browser Source, while the phone sends a continuous WebRTC video track over the local network.

## Current status

- Native OBS source registration and Browser Source receiver wrapper are in place.
- Local signaling service, four per-slot pairing tokens, QR dashboard, and phone camera page are in place.
- Phone pairing requires HTTPS/WSS with a certificate trusted by the phone.
- This is an early scaffold; it has not yet been built or tested end-to-end.

## Static GitHub Pages mode

The simplest deployment does not require the native OBS plugin or the local Node
server. The files in `server/public` can run as a static GitHub Pages site. The
pages use Supabase Realtime Broadcast only for WebRTC signaling; the video stays
peer-to-peer between the phone and OBS browser.

1. Create a Supabase project and copy its project URL and anon key.
2. Put those values in `server/public/config.js`.
3. In the GitHub repository settings, enable Pages with **GitHub Actions**.
4. Push the repository. The included workflow publishes `server/public`.
5. Open the published site, open a camera link on the phone, then copy the
	viewer link into an OBS Browser Source.

The phone and OBS browser must both use the HTTPS GitHub Pages URL. For phones
and OBS on the same network, the default WebRTC ICE configuration is usually
enough. Remote networks may require a TURN server.

## Simple VDO.Ninja mode

The dashboard now uses VDO.Ninja for the media connection. It creates one
`push` link for the phone and one matching `view` link for OBS per slot. This
avoids maintaining a custom signaling and TURN service. Open the camera link
on the phone, allow camera access, then paste the matching viewer link into an
OBS Browser Source.

## Phone pairing server

Install Node.js 20 or newer and [mkcert](https://github.com/FiloSottile/mkcert), then trust a local certificate authority on the phone. On the PC, find its Wi-Fi IPv4 address and run:

```powershell
mkcert -install
mkcert -cert-file cert.pem -key-file key.pem 192.168.1.20
mkcert -CAROOT
cd server
npm install
$env:PHONEOBS_TLS_CERT = "..\\cert.pem"
$env:PHONEOBS_TLS_KEY = "..\\key.pem"
$env:PHONEOBS_HOST = "192.168.1.20"
npm start
```

Use the `rootCA.pem` path printed by `mkcert -CAROOT` to install/trust that CA on the phone (Android: install a CA certificate; iOS: install the profile and enable full trust). Never copy `rootCA-key.pem` to the phone. Allow Node.js through Windows Firewall on the private network. Open `http://127.0.0.1:8888` on the PC to display the four pairing QR codes. The phone and PC must be on the same Wi-Fi. Do not expose port 8443 to the public internet.

The OBS source uses the local receiver URL `http://127.0.0.1:8888/view/<slot>`. Add up to four `Phone Camera` sources in OBS and assign slots 1 through 4. OBS Browser Source must be installed.

## Native build

Install Visual Studio 2022 with the Desktop development with C++ workload and Windows 10/11 SDK, CMake 3.28 or newer, and the matching OBS Studio development package. Configure `CMAKE_PREFIX_PATH` to the OBS development package, then:

```powershell
cmake -S . -B build -A x64 -DCMAKE_PREFIX_PATH="C:\\path\\to\\obs-development-package"
cmake --build build --config RelWithDebInfo
```

The OBS installation alone does not include the `libobs` headers or CMake package required to build plugins.
