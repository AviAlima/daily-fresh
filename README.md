# Daily Fresh

A calm, Microsoft To Do-inspired daily task app. Every day starts with a fresh, blank page — unfinished tasks are never lost, they move to History and can be carried over whenever you want.

## How it works

- **Fresh page every day** — at the hour you choose in Settings (default midnight), your page resets. Each new day is a blank canvas for the day's focus.
- **Nothing is ever lost** — unfinished tasks move to History automatically.
- **Carry over** — pick individual unfinished tasks from previous days (or "Bring all") to add them to today's list. Carried tasks are tagged so you can see where they came from.
- **History** — every past day is stored with its completed and uncompleted tasks.
- **Pleasant experience** — smooth animations, a progress ring, and a fresh-start celebration when a new day begins.

## Stack

Pure static HTML/CSS/JS, zero dependencies. Data is stored in your browser's localStorage.

## Install as an app (PWA)

Daily Fresh is a Progressive Web App — it can be installed on your phone or desktop and run full-screen like a native app, even offline:

- **Android / Chrome desktop**: open Settings → *Install app*, or use the browser's *Install app* prompt
- **iPhone / iPad**: open the site in Safari, tap **Share** → **Add to Home Screen**

Your tasks are stored in the browser, so the app works offline once installed.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Pushing to `main` auto-deploys to GitHub Pages via GitHub Actions.

## Sync between devices (optional)

Daily Fresh can sync your tasks between phone and computer via Firebase Firestore,
with full offline support. Nothing syncs until you opt in:

1. **Enable sync** in Settings on your desktop → a 12-char code appears (with a QR you can scan).
2. On your phone: Settings → **Sync** → enter the code (or scan the QR).
3. Done — both devices stay in sync in real time. The code is your private key:
   only devices with the same code share data.

How it works under the hood:

- **Privacy**: the code never leaves the device — Firestore documents live under a path
  derived from a hash of the code, and the security rules (see `firestore.rules`)
  reject everything else. Sync is opt-in; non-paired users stay localStorage-only.
- **Never lose a task**: every change carries a timestamp. Concurrent edits merge
  per-field (newest wins), adds are always kept, and deleted tasks become tombstones
  so a stale device can never resurrect them. Reorder is last-write-wins (cosmetic).
- **Offline first**: reads are instant from local storage; writes queue locally and
  flush when connected. No network on the tap path.
- **Sync code** is stored only on your devices, never in this repository.

### Activating Firebase

1. Create a project at https://console.firebase.google.com
2. **Firestore Database** → Create database (production mode, any region).
3. **Authentication** → Sign-in method → enable **Anonymous**.
4. **Firestore Database** → Rules → paste the contents of `firestore.rules` → Publish.
5. Project settings → Your apps → Web → register an app → copy the `firebaseConfig`
   object into `src/firebase-config.ts`.
6. Bump the SW cache version in `src/sw.ts` and `APP_VERSION` in `src/app.ts`, commit, push.

Free tier is plenty for personal use (50k reads / 20k writes per day).
