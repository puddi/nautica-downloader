# nautica-downloader
download files from nautica (ksm.dev)

## Usage

```bash
npm install
node nautica-downloader.js [flags...] # downloads all songs
```

This will create a `nautica` directory in the same place where the script is ran and download songs into there. 

You can skip the `npm install` step and replace `node nautica-downloader.js` with `nautica-downloader.exe` if using a distributed version.

## Flags

* `--user user_id`
  * Instead of downloading all songs, downloads only songs uploaded by a specific user.
* `--song song_id`
  * Downloads a specific song.
* `--continue`
  * nautica-downloader keeps track of the last time a song was downloaded. By default, nautica-downloader stops execution after 5 consecutive songs are already marked as downloaded. To force the script to continue checking songs, pass along the continue flag.
* `--switch-windows-zip-extractor`
  * Switches between 7zip and Unar if you're on Windows.

## Zip Encoding

Zip encoding is an absolute mess. nautica-downloader extracts zips using the SHIFT_JIS character encoding, as this provides the correct filenames for a large majority of zip files. However, since Nautica (the website) doesn't care that much about the zip files uploaded, it's possible that a zip file with an incompatible encoding gets uploaded.

If this happens, K-Shoot Mania will most likely throw a Error 12 when launching the game. Delete the song in question (usually either the directory or the files within have some mojibake like "ÉwÉìÉÉãÇ∆ÉOÉåÅÉeÉã" in their names) and the game should launch again. If this happens, please send a message to admin@mg.ksm.dev to have the song marked in the database as "produces mojibake", which will prevent it from being downloaded via this script.

## Build and Release

Assuming that you've installed pkg (`npm install -g pkg`), just run `npm run compile` (or `pkg -t node10-win-x64 nautica-downloader.js`).
