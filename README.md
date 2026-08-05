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
