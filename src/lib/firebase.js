import { record } from './telemetry'

/**
 * Firebase bootstrap and identity.
 *
 * The SDK loads with dynamic import so it never enters the main bundle when
 * Firebase isn't configured.
 *
 * Identity is a two-stage thing on purpose:
 *
 *   1. Everyone starts anonymous. No signup wall in front of the product —
 *      you plan a trip first, and the trip is the reason to keep it.
 *   2. Signing in with Google **links** that anonymous account rather than
 *      replacing it, so everything created beforehand carries over. The uid
 *      survives the upgrade, which is what makes "save this trip" honest.
 */

const cfg = {
  apiKey: import.meta.env?.VITE_FB_API_KEY ?? '',
  authDomain: import.meta.env?.VITE_FB_AUTH_DOMAIN ?? '',
  projectId: import.meta.env?.VITE_FB_PROJECT_ID ?? '',
  storageBucket: import.meta.env?.VITE_FB_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env?.VITE_FB_SENDER_ID ?? '',
  appId: import.meta.env?.VITE_FB_APP_ID ?? '',
}

export const hasFirebase = Boolean(cfg.apiKey && cfg.projectId)

let ready = null
const listeners = new Set()

/** Resolves to { db, auth, uid, FS, AUTH } once, or null when unconfigured. */
export function firebase() {
  if (!hasFirebase) return Promise.resolve(null)
  ready ??= connect()
  return ready
}

async function connect() {
  try {
    const [{ initializeApp }, AUTH, FS] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])

    const app = initializeApp(cfg)
    const auth = AUTH.getAuth(app)
    const db = FS.getFirestore(app)

    // Wait for the first auth state before deciding anything. A session
    // restored from storage — anonymous or Google — is the answer; only a
    // genuine absence of one calls for a new anonymous account.
    //
    // This used to call signInAnonymously() unconditionally alongside the
    // listener, which silently destroyed every Google sign-in. The SDK skips
    // the call only when the current user is *already anonymous*: with a
    // Google user restored it goes ahead and mints a fresh anonymous account,
    // replacing them. So every reload threw the user back to signed-out, the
    // "save your trip" sheet reappeared, and signing in again started the
    // same cycle. Each pass also burned a new uid, which left the trip
    // unreadable because access is by `memberIds`.
    const user = await new Promise((resolve, reject) => {
      let starting = false

      const stop = AUTH.onAuthStateChanged(
        auth,
        (u) => {
          if (u) {
            stop()
            resolve(u)
            return
          }
          // No session at all. Create one, and let the listener above pick up
          // the result. Guarded so a later sign-out cannot start a second.
          if (starting) return
          starting = true
          AUTH.signInAnonymously(auth).catch(reject)
        },
        reject
      )
    })

    // Keep the app informed after the first resolution — a Google link
    // changes displayName and isAnonymous without changing the uid.
    AUTH.onAuthStateChanged(auth, (u) => {
      for (const fn of listeners) {
        try {
          fn(describe(u))
        } catch {
          /* a broken listener must not break auth */
        }
      }
    })

    // `uid` is a getter, not the value captured here. Signing in with Google
    // can land on a different account than the anonymous one this connection
    // opened with, and a snapshot taken now would keep every later write —
    // profiles, trip membership — pointed at the abandoned uid.
    return {
      app,
      auth,
      db,
      FS,
      AUTH,
      get uid() {
        return auth.currentUser?.uid ?? user.uid
      },
    }
  } catch (err) {
    // A misconfigured project must not take the app down; callers treat null
    // as "run locally". Telemetry's console hook records the error.
    console.error('[firebase] connection failed:', err?.message ?? err)
    ready = null
    return null
  }
}

const describe = (u) =>
  u
    ? {
        uid: u.uid,
        anonymous: u.isAnonymous,
        name: u.displayName ?? '',
        email: u.email ?? '',
        photo: u.photoURL ?? '',
      }
    : null

/** Current identity, or null before Firebase resolves. */
export async function currentUser() {
  const fb = await firebase()
  return fb ? describe(fb.auth.currentUser) : null
}

/** Notifies on sign-in, sign-out and account linking. Returns an unsubscribe. */
export function onUser(fn) {
  listeners.add(fn)
  currentUser().then((u) => u && fn(u))
  return () => listeners.delete(fn)
}

/**
 * Upgrades the anonymous account to a Google one, keeping the uid and
 * therefore every trip already created.
 *
 * If that Google account was already linked to a different anonymous session
 * — signing in on a second device, which is the whole point — linking fails
 * with `credential-already-in-use`. Then we sign in to the existing account
 * instead, which is correct: that account already holds their trips.
 */
export async function signInWithGoogle() {
  const fb = await firebase()
  if (!fb) throw new Error('Firebase אינו מוגדר')

  const { AUTH, auth } = fb
  const provider = new AUTH.GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  try {
    const result = await AUTH.linkWithPopup(auth.currentUser, provider)
    return { user: describe(result.user), merged: false }
  } catch (err) {
    if (
      err?.code === 'auth/credential-already-in-use' ||
      err?.code === 'auth/email-already-in-use'
    ) {
      const credential = AUTH.GoogleAuthProvider.credentialFromError(err)
      const result = await AUTH.signInWithCredential(auth, credential)
      // `merged` tells the UI this device joined an existing account, so it
      // can say "your trips are here" rather than "saved".
      return { user: describe(result.user), merged: true }
    }
    if (err?.code === 'auth/popup-closed-by-user') {
      throw new Error('ההתחברות בוטלה')
    }
    // The UI only ever shows a generic message, which is fine for the user
    // but useless for finding out what actually failed on their device —
    // the real Firebase error code is worth keeping.
    record({ kind: 'auth', message: `signInWithGoogle: ${err?.code ?? 'unknown'} — ${err?.message ?? ''}`, stack: err?.stack })
    throw new Error(err?.message ?? 'ההתחברות נכשלה')
  }
}

/** Signs out and drops back to a fresh anonymous session. */
export async function signOutUser() {
  const fb = await firebase()
  if (!fb) return
  await fb.AUTH.signOut(fb.auth)
  await fb.AUTH.signInAnonymously(fb.auth)
}
