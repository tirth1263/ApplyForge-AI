import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics'
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

const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyC-qnB_qCiIu7_kMVXKnEqx06xI-B6dk0k',
  authDomain: 'applyforge-ai.firebaseapp.com',
  projectId: 'applyforge-ai',
  storageBucket: 'applyforge-ai.firebasestorage.app',
  messagingSenderId: '75705445753',
  appId: '1:75705445753:web:e93c115944ba16c13bd3a8',
  measurementId: 'G-1Z7KP10G1H',
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fallbackFirebaseConfig.projectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || fallbackFirebaseConfig.measurementId,
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
let analytics: Analytics | undefined

if (firebaseConfigIsComplete) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  auth = getAuth(app)
  auth.useDeviceLanguage()
  db = getFirestore(app)
  functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1')
  storage = getStorage(app)

  void isSupported().then((supported) => {
    if (supported && app) {
      analytics = getAnalytics(app)
    }
  })
}

export { app, auth, db, functions, storage, analytics, firebaseConfig }

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
