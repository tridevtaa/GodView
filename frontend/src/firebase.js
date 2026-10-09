import { initializeApp } from "firebase/app";
import {
  CACHE_SIZE_UNLIMITED,
  clearIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Read Firebase config from Vite env vars so local/dev/prod setup does not
// require editing source files.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(
    `Missing Firebase env vars: ${missingKeys.join(", ")}. ` +
      "Set them in frontend/.env before starting Vite."
  );
}

const app = initializeApp(firebaseConfig);

// Keep fetched documents in the browser (IndexedDB) so reloads read from the
// local copy and only ask the server for what changed. Falls back to memory
// automatically where IndexedDB isn't available (e.g. some private windows).
export const db = initializeFirestore(app, {
  // Unlimited so cached records are never evicted: the student list is built
  // from this cache plus recent changes, so an evicted record would vanish.
  localCache: persistentLocalCache({
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    tabManager: persistentMultipleTabManager(),
  }),
});
export const auth = getAuth(app);

// Removes every locally cached document (student data) from this browser.
export async function clearLocalData() {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // Another tab may still hold the cache; it is cleared when that tab closes.
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("godview."))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked; nothing to clear.
  }
}
