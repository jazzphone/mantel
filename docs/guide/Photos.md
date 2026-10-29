# Photos

Mantel Photos is Mantel's own photo library for the screensavers. Upload
photos in bulk, sort them into albums, and choose an album for every screen or
for one screen at a time. Photos are cleaned on the way in (the location and
every other bit of metadata are removed), kept in Mantel's data, and included
in Mantel's encrypted backups. Nothing changes in Home Assistant.

You can still use a Home Assistant media folder, as HK Frontend's
[Screensaver](https://github.com/jazzphone/hk-frontend/wiki/Screensaver-and-Idle)
does. Mantel Photos is an extra choice beside it.

## Where it is

**Mantel Settings → Your Files → Photos.** Owners and Admins see it.

| Group | What it has |
|---|---|
| **Albums** | Each album with its cover, how many photos and their size. **New Album…** |
| An album's page | The grid of photos, **Add Photos…**, **Select Photos**, **Rename Album…**, **Delete Album…** |
| **Import from Home Assistant** | Copies the pictures in a Home Assistant media folder into an album (Owners) |
| **Storage** | **Space used** against **Space for Photos**, the **Largest Photo** one upload may be, and whether the photos are in your backups |

## Make an album and add photos

1. Open **Mantel Settings → Your Files → Photos**.
2. Select **New Album…**, give it a name, and select **Create**.
3. Open the album and select **Add Photos…**. Choose as many photos as you
   like, or drop them on the page. They upload a few at a time, and each file
   says how it went: **Uploaded**, **Already in this album**, or why it was
   refused.

Select a photo to see it large; the arrow keys go to the previous and next
photo. To move or delete several at once, select **Select Photos**, tick them,
then **Move to Album** or **Delete…**.

Each photo is in exactly one album. Deleting an album deletes its photos.

### What Mantel accepts

- **JPEG, PNG, WebP and HEIC** (iPhone photos). Mantel looks at the file
  itself, not its name, so a renamed file is still checked.
- Up to **40 MB** per photo and **64 megapixels**.
- All photos together up to **4 GB**.

An Owner changes the two size limits under **Storage**: one upload from 1 MB
to 200 MB, and all photos from 100 MB to 1 TB.

### What Mantel does to each photo

1. Turns it upright, as the camera recorded it.
2. **Removes all metadata**: the GPS location, the camera, the date and every
   other EXIF and XMP field. The bytes you uploaded are not kept.
3. Converts wide-gamut colour to standard colour, and puts transparent areas
   on black.
4. Saves three sizes:

| Size | Used for |
|---|---|
| Original, up to 8192 px on the long side (JPEG) | Kept for Owners and Admins |
| Screen, 2560 px (JPEG) | What the screensavers show |
| Thumbnail, 480 px (WebP) | The grid |

The same photo twice in one album is skipped, so uploading a folder again is
safe.

## Keep in View: faces stay on screen

A screensaver crops a photo to fill the screen, or a cell of the Mosaic. So
that heads aren't cut off, Mantel finds where the faces are in each photo, once,
and the screensavers crop and zoom around them.

- **Only where, never who.** Mantel finds boxes around faces. It doesn't
  recognise anyone, and it keeps no face data beyond those boxes. It all
  happens on your Mantel server; nothing is sent anywhere.
- **New photos** are checked as they're uploaded. **Photos already in Mantel**
  are checked in the background, one at a time, starting a minute after Mantel
  starts. The log says when it's done: "checked N photos for faces".
- **Set it by hand.** Open a photo in an album, then tap **Keep in View**.
  The faces Mantel found show as faint boxes: the screens keep them all in
  view when they fit, or else the largest. Tap the photo where the screens
  should keep it in view instead; a ring marks that point. To let
  Mantel choose again, tap **Automatic**. With a keyboard, press Enter on the
  photo to keep its middle in view.
- The words under the photo say what's set: how many faces were found, **Set
  by hand**, **No faces found** (the screen's own Focus setting is used), or
  **Not checked yet**.
- **The Mosaic** also picks layouts that fit the photos' shapes, with tall
  cells for portrait photos.

Only Mantel Photos albums have Keep in View. Photos from a Home Assistant
media folder are cropped as before. If faces can't be found on your server's
platform, Setup Check says so, and the screens use their own Focus setting.

## Choose an album for a screen

**Every screen.** Open **Mantel Settings → All Screens → Screensaver**. Under
**Screensaver Photos**, set **Mantel Photos Album** to an album. To go back
to the Home Assistant folder, pick the folder again.

**One screen.** Open that screen's **Screensaver Options** in Mantel Settings. In the **Photos**
group, set **Show** to:

- **Screensaver Photos (All Screens)**: whatever every screen shows, or
- an album, or
- **New Album…**, which makes an album and picks it.

With an album picked, **Add Photos to** *album*… is right under it, so you can
fill a screen's album without leaving its settings.

A screen picks up an album's new photos the next time it lists them (within
30 minutes), or at once in the browser where you made the change. Deleting an
album sends its screens back to the photos all screens show.

## Import from a Home Assistant media folder

If your photos already live in a Home Assistant media folder, copy them into
Mantel once. Only an Owner can start an import.

1. **Mantel Settings → Your Files → Photos → Import from Home Assistant.**
2. **Folder**: the media folder, for example
   `media-source://media_source/local/photos`. It starts filled in with the
   folder your screensavers use.
3. **Into Album**: pick an album.
4. Select **Copy Photos Into Album**.

Mantel walks the folder and its subfolders (up to four levels down), at most
5,000 pictures, and adds each one exactly like an upload: the same checks, the
same limits, and duplicates skipped.
The page shows the progress, and **Stop Import** stops it. When it ends, the
page lists any pictures that could not be copied, and why.

Nothing in Home Assistant is changed or deleted. Only Home Assistant's own
media folders are read; cameras and other sources are skipped.

**Recommended on All Screens → Screensaver.** While every screen's
**Screensaver Photos** is a Home Assistant folder, an Owner sees a
recommendation under it: *Import these into Mantel Photos: tablets get
screen-sized copies, and faces stay in view.* **Import into a New Album**
asks for the album's name (the folder's, to start with), makes it and runs
this same import from that folder, its progress shown right there. When the
import is done, every screen shows the new album. One that is stopped or
fails changes nothing. You can leave the page while it copies; the switch
happens the next time you open All Screens → Screensaver in that browser.

## Who may do what

| | Owner | Admin | Adult, Child | Wall tablet | Guest |
|---|---|---|---|---|---|
| Albums, upload, move, delete, a screen's album, Keep in View | Yes | Yes | No | No | No |
| Change the limits, import from Home Assistant | Yes | No | No | No | No |
| See the screensaver's photos | Yes | Yes | Yes | Yes | No |
| Open an original | Yes | Yes | No | No | No |

Every change is in the [Audit Log](Commands-and-Audit.md): albums made,
renamed and deleted, uploads, moves, deletes, limits, a screen's album, a
focus set by hand or put back to Automatic, and each import.

## Backups

Photos are part of **Your Files**, so they are inside Mantel's encrypted
backup with your font and glyphs. A restore puts them back with their albums.
**Storage** says how big they are and whether they are in your backups.

If you run Mantel as the Home Assistant App, its data is also in Home
Assistant's own backups of the App.

A backup made with "no files" leaves Your Files, photos included, out. See
[Backups](Backups.md).

## Notes

- **HEIC needs the server's HEIC support.** Mantel's images include it. If a
  server can't read HEIC, the upload says so; export the photo as JPEG
  instead.
- **Photos are private to signed-in people and tablets.** The screensaver's
  sizes are served only to someone who may see the screensaver photos; an
  album you may not see answers "not found".
- Mantel Photos exists only in Mantel. HK Frontend inside Home Assistant never
  sees the albums or a screen's album choice.
