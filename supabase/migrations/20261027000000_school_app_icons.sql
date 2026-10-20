-- Each school's home screen icon: its logo on a white square, in sizes for
-- iPhone and Android, plus an install file (manifest) naming the school.
-- They live next to the logo in the public school-logos bucket, under
-- <school id>/app/, made by the app the first time an owner opens it after
-- the logo is set or changed. The bucket took images only; the install
-- file is JSON.

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/manifest+json']
where id = 'school-logos';
