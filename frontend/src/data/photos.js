import { useEffect, useState } from "react";
import { doc, getDoc, getDocFromCache, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { stamp } from "./usePeople.js";

// Photos live in their own collection ("photos/{kind}-{id}") as small JPEG
// data URLs, so loading the student list stays light. The person document
// only carries `has_photo`, which tells cards whether to fetch one at all,
// and `photo_v`, a version that changes on every upload. Photos are read from
// the browser cache when the cached version matches, so each one is fetched
// from the server once per browser rather than on every visit.

const SIZE = 400; // square, px
const QUALITY = 0.82;
const cache = new Map(); // photo doc id -> data URL (or a pending Promise)
const listeners = new Map(); // photo doc id -> Set of setState callbacks

const photoId = (kind, id) => `${kind}-${id}`;
// Memory-cache key: a new upload (new version) must not reuse the old image.
const memKey = (key, v) => `${key}@${v ?? 0}`;

function publish(key, url) {
  cache.set(key, url);
  listeners.get(key)?.forEach((fn) => fn(url));
}

async function fetchPhoto(key, v) {
  const ref = doc(db, "photos", key);
  try {
    const local = await getDocFromCache(ref);
    // Photos uploaded before versioning have no `v`; trust the cache for them.
    if (local.exists() && (v === undefined || local.data().v === v)) return local.data().data;
  } catch {
    // Not cached yet.
  }
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().data : "";
}

function load(key, v) {
  const mk = memKey(key, v);
  if (cache.has(mk)) return cache.get(mk);
  const pending = fetchPhoto(key, v)
    .then((url) => {
      publish(mk, url);
      return url;
    })
    .catch(() => {
      cache.delete(mk);
      return "";
    });
  cache.set(mk, pending);
  return pending;
}

// Returns the photo data URL for a person, "" while loading or if none.
export function usePhoto(kind, person) {
  const key = memKey(photoId(kind, person.id), person.photo_v);
  const cached = cache.get(key);
  const [url, setUrl] = useState(typeof cached === "string" ? cached : "");

  useEffect(() => {
    if (!person.has_photo) return setUrl("");
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(setUrl);
    Promise.resolve(load(photoId(kind, person.id), person.photo_v)).then((u) => typeof u === "string" && setUrl(u));
    return () => set.delete(setUrl);
  }, [key, kind, person.id, person.photo_v, person.has_photo]);

  return url;
}

// Centre-crops and scales an image file to a SIZE×SIZE JPEG data URL.
async function toThumbnail(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

// Saves a new photo and flags the person as having one. Returns the fields
// changed on the person document.
export async function savePhoto(kind, id, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const data = await toThumbnail(file);
  const key = photoId(kind, id);
  const v = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, "photos", key), {
    data,
    v,
    ...stamp(),
    updated_by: auth.currentUser?.email ?? "",
  });
  batch.update(doc(db, kind, id), { has_photo: true, photo_v: v, ...stamp() });
  await batch.commit();
  publish(memKey(key, v), data);
  return { has_photo: true, photo_v: v };
}
