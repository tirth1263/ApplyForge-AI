import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const firebaseConfigIsComplete = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
].every(Boolean)

let app: FirebaseApp | undefined
let auth: Auth | undefined
let db: Firestore | undefined
let functions: Functions | undefined
let storage: FirebaseStorage | undefined

if (firebaseConfigIsComplete) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1')
  storage = getStorage(app)
}

export { app, auth, db, functions, storage }

export async function signInWithGoogle() {
  if (!auth) {
    throw new Error('Firebase is not configured yet.')
  }

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(auth, provider)
}

export async function signOutOfGoogle() {
  if (!auth) return
  return signOut(auth)
}

export function getAuthErrorMessage(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''

  if (code === 'auth/configuration-not-found') {
    return [
      'Firebase Auth is not initialized for project applyforge-ai.',
      'Open Firebase Console > Authentication, click Get started, enable Google sign-in, and confirm applyforge-ai.web.app is an authorized domain.',
    ].join(' ')
  }

  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorized in Firebase Auth. Add applyforge-ai.web.app under Authentication > Settings > Authorized domains.'
  }

  if (code === 'auth/popup-blocked') {
    return 'The browser blocked the Google sign-in popup. Allow popups for this site and try again.'
  }

  if (error instanceof Error) return error.message
  return 'Google sign-in failed. Check Firebase Authentication settings for applyforge-ai.'
}
