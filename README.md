# AfriAce — frontend deploy

Plain HTML/CSS/JS, no build step. This is the **student portal only** —
teacher, school-admin and super-admin portals aren't built yet, so
`index.html` just redirects to `student-portal.html`.

```
index.html              redirects to student-portal.html
student-portal.html     the app
afriace-client.js       Supabase client + data-access helpers
afriace-learning.js     quiz/mastery/spaced-repetition logic
afriace-quiz-ui.js      quiz, mock exam, theory self-marking, flashcards, weak-topics screens
manifest.json           PWA manifest
sw.js                   service worker (offline shell + push)
icons/afriace-icon.svg  PLACEHOLDER icon — replace with real branding before launch
```

## Before you push
Open `afriace-client.js` and set your real Supabase anon key:
```js
supabaseAnonKey: '<your anon/public key>',
```
It's meant to be public (row-level security protects the data), so it's
fine to commit once filled in.

## Host it
Push this folder to a GitHub repo, then any static host works — GitHub
Pages (Settings → Pages → deploy from this branch, root folder), Netlify,
Vercel, Cloudflare Pages, etc.

## Backend
The database (migrations 001–014) and edge functions already live on your
Supabase project separately — nothing here deploys them. Ask if you want
those files again.
