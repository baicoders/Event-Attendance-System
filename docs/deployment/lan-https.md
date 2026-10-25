# LAN HTTPS Deployment Guide

This guide documents the HTTPS setup used to deploy the Event Attendance System on a local network for event use.

## Deployment Architecture

The production application runs on a central laptop:

    Staff Devices
          │
          │ HTTPS
          ▼
    Caddy :443
          │
          │ HTTP
          ▼
    Next.js :3000

Caddy handles HTTPS and reverse-proxies requests to the Next.js production server.

The application should be accessed through:

    https://<server-ip>

Do not access the production application directly through port `3000` from staff devices.

---

# 1. Why HTTPS Is Required

The system uses:

- Secure authentication cookies in production
- `navigator.mediaDevices.getUserMedia()` for QR camera scanning

Both require HTTPS when accessed from another device on the LAN.

Accessing the application as:

    http://<server-ip>:3000

causes problems because:

1. Secure cookies are not stored/sent over plain HTTP.
2. Browser camera APIs are unavailable outside a secure context.

The host laptop may work through `localhost`, but other devices accessing the laptop's LAN IP do not receive the same browser exemption.

---

# 2. Install and Run Next.js

Build and start the application normally:

    pnpm build
    pnpm start

Next.js runs on port `3000`.

Caddy will proxy requests to this port.

Do not expose port `3000` to staff devices unless necessary.

---

# 3. Install Caddy

Caddy is used as the HTTPS reverse proxy.

Install Caddy on the central server laptop before continuing.

Official installation instructions:

https://caddyserver.com/docs/install

After installation, verify:

    caddy version

The commands below assume that `caddy` is available from the system PATH.

---

# 4. Configure Caddy

Place a `Caddyfile` in the project root.

Example:

    192.168.254.148 {
        reverse_proxy localhost:3000
    }

Replace the IP address with the server laptop's actual LAN IP.

Validate the configuration:

    caddy validate --config Caddyfile

Run Caddy:

    caddy run

Caddy automatically handles HTTPS and redirects HTTP traffic to HTTPS.

The application is then accessed through:

    https://<server-ip>

not:

    https://<server-ip>:3000

Port `3000` is plain HTTP and belongs to Next.js.

---

# 5. Linux Server Setup

## Allow Caddy to Use Ports 80 and 443

Running Caddy as a normal Linux user may produce:

    listen tcp :80: bind: permission denied

Give the Caddy binary permission to bind to privileged ports:

    sudo setcap cap_net_bind_service=+ep "$(which caddy)"

Verify:

    getcap "$(which caddy)"

Then run Caddy normally:

    caddy run

Do not run the entire Caddy process as root unless there is a specific reason to do so.

## Linux Firewall

If UFW is enabled, it may block incoming connections from staff devices.

Check:

    sudo ufw status

If the event network is:

    192.168.254.0/24

allow HTTP and HTTPS from the LAN:

    sudo ufw allow from 192.168.254.0/24 to any port 80 proto tcp
    sudo ufw allow from 192.168.254.0/24 to any port 443 proto tcp

Then:

    sudo ufw enable

Port `3000` should not need to be exposed to staff devices because Caddy proxies requests to it locally.

---

# 6. Windows Server Setup

## Install Caddy

Download and install Caddy for Windows:

https://caddyserver.com/download

Make sure the `caddy` executable is available from the terminal.

Verify:

    caddy version

## Run Caddy

Open PowerShell in the project directory.

Validate the configuration:

    caddy validate --config Caddyfile

Start Caddy:

    caddy run

Windows does not require the Linux `setcap` step.

Caddy will listen on ports `80` and `443`.

If Windows Defender Firewall prompts for network access, allow Caddy to communicate on the local/private network.

If the firewall was previously configured to block Caddy, create inbound rules allowing TCP:

    80
    443

from the local network.

Do not expose port `3000` to staff devices unless necessary.

## Running Caddy Automatically

For event deployment, Caddy can be run manually:

    caddy run

This is sufficient if the server is started specifically for the event.

If Caddy needs to run automatically as a Windows service, follow Caddy's Windows service documentation rather than creating an ad-hoc startup script.

---

# 7. Trust Caddy's Local Certificate

Caddy uses its own local Certificate Authority for local HTTPS.

The root certificate is:

    root.crt

Find it with:

    find ~/.local/share/caddy -name root.crt

On Windows, the Caddy data directory may differ depending on how Caddy is run.

Only distribute:

    root.crt

Never distribute:

    root.key

The private key must remain on the server.

---

# 8. Install the Root Certificate on Staff Devices

Every device that will access the system should trust Caddy's local CA.

## Linux

Install the certificate into the system trust store:

    sudo cp root.crt /usr/local/share/ca-certificates/caddy-local.crt
    sudo update-ca-certificates

For Firefox, if the certificate is still not trusted, import `root.crt` through:

    Firefox
    → Settings
    → Privacy & Security
    → Certificates
    → View Certificates
    → Authorities
    → Import

Caddy can also install its local CA into the system trust store:

    caddy trust

Restart the browser after changing certificate trust.

## Windows

Copy `root.crt` to the Windows device.

Open the certificate and select:

    Install Certificate

Install it into:

    Trusted Root Certification Authorities

Restart the browser after installation.

## Android

Transfer `root.crt` to the Android device.

Install it through the device's certificate settings as a **CA certificate**.

The exact menu varies by Android version and manufacturer.

After installation, restart the browser and test:

    https://<server-ip>

A browser may still display a warning or indication that the certificate is locally issued. This is expected for Caddy's private CA.

The important requirements are that:

- HTTPS connects successfully.
- The page is treated as a secure context.
- Camera access works.
- Authentication works.

## iOS / iPadOS

Transfer `root.crt` to the device and install the resulting certificate profile.

After installing it, go to:

    Settings
    → General
    → About
    → Certificate Trust Settings

Enable full trust for the Caddy root certificate.

Then test:

    https://<server-ip>

---

# 9. Verify the Server

Check that the required services are listening.

Linux:

    ss -ltnp | grep -E ':80|:443|:3000'

Windows PowerShell:

    Get-NetTCPConnection -LocalPort 80,443,3000

Expected:

    :80     Caddy
    :443    Caddy
    :3000   Next.js

Verify the certificate served for the LAN IP:

    openssl s_client -connect <server-ip>:443 -showcerts </dev/null 2>/dev/null \
      | openssl x509 -noout -subject -issuer -ext subjectAltName

The certificate should contain the server's LAN IP in `Subject Alternative Name`.

---

# 10. Verify Staff Devices

On every device that will be used during the event:

1. Connect to the same Wi-Fi network.
2. Open:

   https://<server-ip>

3. Confirm the application loads.
4. Log in.
5. Refresh the page.
6. Navigate to another authenticated page.
7. Open the QR scanner.
8. Grant camera permission.
9. Scan a test QR code.
10. Verify that attendance is recorded.

The HTTPS deployment is not considered verified until this has been tested on the actual devices used for the event.

---

# 11. Common Problems

## `listen tcp :80: bind: permission denied`

Linux Caddy does not have permission to bind to privileged ports.

Run:

    sudo setcap cap_net_bind_service=+ep "$(which caddy)"

Windows does not require this step.

---

## `ERR_SSL_PROTOCOL_ERROR` when using port 3000

Do not access:

    https://<server-ip>:3000

Next.js serves plain HTTP on port `3000`.

Use:

    https://<server-ip>

Caddy handles HTTPS on port `443`.

---

## Android cannot reach the server

First verify LAN connectivity.

The devices should:

- Be connected to the same network.
- Have IP addresses on the same subnet.
- Be able to ping each other.

If ping works but HTTP/HTTPS does not, check the server firewall.

On Linux, UFW may be blocking ports `80` and `443`.

On Windows, check Windows Defender Firewall and ensure Caddy is allowed on the private network.

---

## Certificate is still reported as untrusted

Make sure `root.crt` was installed as a trusted **CA certificate**, not simply downloaded or installed as a normal certificate.

Browser-specific trust stores may also need to be configured.

---

## Camera does not work

Verify that the application is being accessed through:

    https://<server-ip>

and not:

    http://<server-ip>:3000

The QR scanner requires a secure browser context.

---

## Server is reachable by ping but not by browser

Check the firewall first.

The server may be reachable through ICMP while TCP ports `80` and `443` are blocked.

Verify that Caddy is listening:

Linux:

    ss -ltnp | grep -E ':80|:443'

Windows:

    Get-NetTCPConnection -LocalPort 80,443

Then verify the firewall configuration.

---

# 12. Production Environment

HTTPS does not configure the application's authentication secret.

Set `AUTH_SECRET` in the production environment before deployment.

Generate a suitable secret with:

    openssl rand -base64 32

Do not commit the secret to Git.

See the main project README for the required environment variables.

---

# Event-Day Checklist

## Server

- [ ] Connect server laptop to event Wi-Fi.
- [ ] Confirm LAN IP.
- [ ] Configure production environment variables.
- [ ] Set `AUTH_SECRET`.
- [ ] Build with `pnpm build`.
- [ ] Start Next.js with `pnpm start`.
- [ ] Start Caddy.
- [ ] Verify ports `80` and `443`.
- [ ] Verify firewall allows LAN traffic.
- [ ] Open `https://<server-ip>` locally.

## Staff Devices

- [ ] Connect to event Wi-Fi.
- [ ] Install/trust Caddy `root.crt`.
- [ ] Open `https://<server-ip>`.
- [ ] Log in successfully.
- [ ] Refresh and verify the session persists.
- [ ] Test QR camera.
- [ ] Scan a test attendance QR code.

## Final Rehearsal

Perform the complete workflow using the actual server laptop, Wi-Fi network, and staff devices that will be used during the event.


# Offline QR Scanning

Prepare dependencies and build the app before the event. Dependency installation
and the Google Fonts build step need internet; attendance operation does not.
Next copies the scanner's matching decoder from `node_modules` into
`public/qr-decoder/` when loading its configuration. The generated files are not
committed, and no runtime download from a public CDN is needed.

Keep the generated public assets with the production app. A request to
`https://<server-ip>/qr-decoder/zxing_reader.wasm` should return HTTP 200 with
`application/wasm`. Caddy proxies this file along with the rest of the site.

Use an updated **Chrome for Android** for attendance. Samsung Internet for Android
and Opera for Android also provide native barcode detection. Chrome's native API
is platform-specific: desktop Linux/Windows do not provide it by default. The app
now serves its own decoder, so it does not depend on native detection being present.
See [MDN's compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json).

Before the event, turn off cellular data and outside internet while keeping the
phone connected to school Wi-Fi. Open a fresh browser session at the trusted
Caddy HTTPS address and scan a printed card. This tests certificate trust, the
physical camera, and the actual school network together.
