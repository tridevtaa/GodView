import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase.js";

// Photos live in their own collection ("photos/{kind}-{id}") as small JPEG
// data URLs, so loading the student list stays light. The person document
// only carries `has_photo`, which tells cards whether to fetch one at all.

const SIZE = 400; // square, px
const QUALITY = 0.82;
const cache = new Map(); // photo doc id -> data URL (or a pending Promise)
const listeners = new Map(); // photo doc id -> Set of setState callbacks

const photoId = (kind, id) => `${kind}-${id}`;

function publish(key, url) {
  cache.set(key, url);
  listeners.get(key)?.forEach((fn) => fn(url));
}

function load(key) {
  if (cache.has(key)) return cache.get(key);
  const pending = getDoc(doc(db, "photos", key))
    .then((snap) => {
      const url = snap.exists() ? snap.data().data : "";
      publish(key, url);
      return url;
    })
    .catch(() => {
      cache.delete(key);
      return "";
    });
  cache.set(key, pending);
  return pending;
}

// Returns the photo data URL for a person, "" while loading or if none.
export function usePhoto(kind, person) {
  const key = photoId(kind, person.id);
  const cached = cache.get(key);
  const [url, setUrl] = useState(typeof cached === "string" ? cached : "");

  useEffect(() => {
    if (!person.has_photo) return setUrl("");
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(setUrl);
    Promise.resolve(load(key)).then((u) => typeof u === "string" && setUrl(u));
    return () => set.delete(setUrl);
  }, [key, person.has_photo]);

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

// Saves a new photo and flags the person as having one. Returns the data URL.
export async function savePhoto(kind, id, file) {
  if (!file.type.startsWith("image/")) throw new Error("not-an-image");
  const data = await toThumbnail(file);
  const key = photoId(kind, id);
  const batch = writeBatch(db);
  batch.set(doc(db, "photos", key), {
    data,
    updated_at: serverTimestamp(),
    updated_by: auth.currentUser?.email ?? "",
  });
  batch.update(doc(db, kind, id), { has_photo: true });
  await batch.commit();
  publish(key, data);
  return data;
}
