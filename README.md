# ApplyPilot AI

A professional job application workspace for searching roles, tailoring a resume to each job description, generating cover letters, saving jobs, and storing application history in Firebase.

## What is included

- React + TypeScript website built with Vite
- Firebase Hosting configuration
- Firebase Auth-ready Google sign-in
- Firestore rules for private per-user application data
- Cloud Functions for AI resume and cover-letter generation
- Cloud Functions job search aggregation with Remotive plus optional Adzuna and JSearch credentials
- GitHub Actions workflow for Firebase deploys from `main`
- PowerShell helper for creating/pushing the GitHub repository with `gh`

## Local setup

```powershell
npm install
npm install --prefix functions
Copy-Item .env.example .env
Copy-Item .firebaserc.example .firebaserc
Copy-Item functions\.env.example functions\.env
```

Fill `.env` with your Firebase web app config from Firebase Console.

Update `.firebaserc` with your Firebase project ID.

Run the website:

```powershell
npm run dev
```

## Firebase setup

In Firebase Console:

1. Create or select your Firebase project.
2. Add a Web app and copy its config into `.env`.
3. Enable Authentication and the Google provider.
4. Create Firestore Database.
5. Enable Storage if you want to add resume file uploads later.
6. Set the OpenAI secret:

```powershell
firebase login
firebase use --add
firebase functions:secrets:set OPENAI_API_KEY
```

Optional job provider keys can be placed in `functions/.env` for local emulators and `functions/.env.<your-project-id>` before deployment:

```env
ADZUNA_APP_ID=...
ADZUNA_APP_KEY=...
JSEARCH_API_KEY=...
```

Remotive works without credentials. Adzuna and JSearch broaden worldwide coverage when keys are provided.

## Deploy

```powershell
npm run firebase:deploy
```

This builds the React app, builds Cloud Functions, and deploys Hosting, Functions, Firestore rules/indexes, and Storage rules.

## GitHub

Your installed GitHub CLI currently needs a fresh login before this project can be pushed.

```powershell
gh auth login -h github.com
npm run github:push -- -RepoName applypilot-ai-job-application -Visibility private -Message "Initial ApplyPilot AI build"
```

After that, run `npm run github:push -- -Message "Describe your change"` whenever you want to commit and push updates.

For automatic Firebase deploys from GitHub, add these repository secrets:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

The `FIREBASE_SERVICE_ACCOUNT` value should be a service account JSON with permission to deploy Hosting, Functions, Firestore rules/indexes, and Storage rules.
