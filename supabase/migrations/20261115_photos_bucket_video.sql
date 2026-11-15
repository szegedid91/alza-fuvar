-- Visszáru-videó az elszámoláshoz: a „photos” tároló eddig csak képet engedett 8 MB-ig.
-- Videó (mp4 / webm / mov) is mehet, fájlonként legfeljebb 50 MB.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
 where id = 'photos';
