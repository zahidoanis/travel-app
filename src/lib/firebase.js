/**
 * Firebase bootstrap.
 *
 * The SDK is loaded with dynamic import so it never enters the main bundle
 * when Firebase isn't configured — the app stays fully usable offline and
 * keyless, and only pays the ~250KB when there's actually a project to talk to.
 *
 * Sign-in is anonymous: every device gets a stable uid with no signup form.
 * That's what lets security rules scope data per user without asking anyone to
 * create an account.
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

/**
 * Resolves to { db, auth, uid, FS } once, or null when unconfigured.
 * `FS` carries the Firestore functions so callers don't each import them.
 */
export function firebase() {
  if (!hasFirebase) return Promise.resolve(null)
  ready ??= connect()
  return ready
}

async function connect() {
  try {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])

    const app = initializeApp(cfg)
    const auth = authMod.getAuth(app)
    const db = fsMod.getFirestore(app)

    const uid = await new Promise((resolve, reject) => {
      const stop = authMod.onAuthStateChanged(
        auth,
        (user) => {
          if (user) {
            stop()
            resolve(user.uid)
          }
        },
        reject
      )
      // No session yet — create an anonymous one.
      authMod.signInAnonymously(auth).catch(reject)
    })

    return { app, auth, db, uid, FS: fsMod }
  } catch (err) {
    // A misconfigured project must not take the app down; callers treat null
    // as "run locally". The error is still recorded by telemetry's console hook.
    console.error('[firebase] connection failed:', err?.message ?? err)
    ready = null
    return null
  }
}
