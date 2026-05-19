# Firebase Setup for ApplyForge AI

## Firebase Project

- Project ID: `applyforge-ai`
- Auth domain: `applyforge-ai.firebaseapp.com`
- Storage bucket: `applyforge-ai.firebasestorage.app`
- Functions region: `us-central1`

## Local Environment

The app reads Firebase values from `.env`.

```env
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=applyforge-ai.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=applyforge-ai
VITE_FIREBASE_STORAGE_BUCKET=applyforge-ai.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=75705445753
VITE_FIREBASE_APP_ID=your-firebase-app-id
VITE_FIREBASE_MEASUREMENT_ID=G-1Z7KP10G1H
VITE_FIREBASE_FUNCTIONS_REGION=us-central1
```

The Firebase CLI project is stored in `.firebaserc`.

```json
{
  "projects": {
    "default": "applyforge-ai"
  }
}
```

## Firebase Console Checklist

1. Enable Google Authentication.
2. Create a Firestore Database.
3. Enable Storage.
4. Confirm the web app config matches `.env`.
5. Add authorized domains for local and production hosting.
6. Upgrade to Blaze before deploying Cloud Functions secrets.

## Google Sign-In Troubleshooting

If the app shows `auth/configuration-not-found`, Firebase Auth is not initialized for the `applyforge-ai` project yet.

1. Open [Firebase Authentication providers](https://console.firebase.google.com/project/applyforge-ai/authentication/providers).
2. Click **Get started** if Firebase asks you to initialize Authentication.
3. Enable **Google** as a sign-in provider.
4. Open **Authentication > Settings > Authorized domains**.
5. Confirm these domains are present:

```text
applyforge-ai.firebaseapp.com
applyforge-ai.web.app
localhost
```

## Cloud Functions Secrets

Set the OpenAI API key as a Firebase Functions secret.

```powershell
firebase functions:secrets:set OPENAI_API_KEY
```

Firebase Functions secrets require the Blaze plan because they use Google Secret Manager.

Optional job-provider keys can be added in `functions/.env` for local development.

```env
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
JSEARCH_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
```

## Local Commands

```powershell
npm run dev
npm run lint
npm run build
npm run functions:build
```

Run Firebase emulators:

```powershell
npm run emulators
```

Deploy to Firebase:

```powershell
npm run firebase:deploy
```

## GitHub Actions Secrets

Add these secrets to the GitHub repository before using automatic Firebase deploys:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

## Data Storage

User-specific data is stored under:

```text
users/{userId}
users/{userId}/savedJobs
users/{userId}/applications
users/{userId}/aiRuns
users/{userId}/jobSearches
users/{userId}/resumes
```

Firestore rules only allow signed-in users to read and write their own user documents. Storage rules only allow users to access files under their own `users/{userId}` path.
