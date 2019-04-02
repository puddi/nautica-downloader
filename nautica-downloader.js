const base = 'https://ksm.dev';

const axios = require('axios').create({
  baseURL: `${base}/app`
});

const minimist = require('minimist');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const rimraf = require('rimraf');
const iconv = require('iconv-lite');
const AdmZip = require('adm-zip');
const mkdirp = require('mkdirp');

class NauticaDownloader {
  constructor() {
    this.createNauticaDirectory();
  }

  /**
   * Iterates through every song provided by Nautica since the last execution time and downloads them
   * @param shouldContinue - default false. if true, will not short-circuit execution when 5 up to date songs are encountered
   */
  async downloadAll(shouldContinue) {
    console.log('Downloading all songs.');

    let response;
    let consecutiveUpToDates = 0;
    AllDoLoop:
    do {
      // fetch the songs
      response = (await axios.get(response ? response.links.next : 'songs?sort=uploaded')).data;
      for (let i = 0; i < response.data.length; i++) {
        let song = response.data[i];
        console.log('=====================');
        console.log(`Song: ${song.title} - ${song.artist}`);

        if (song.mojibake) {
          console.log('Zip file is marked as producing mojibake. Skipping.');
          continue;
        }

        let lastDownloaded = this.getWhenSongWasLastDownloaded(song.id);
        if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
          // we're up to date! break out.
          console.log('Already up to date! Skipping.');
          this.setWhenSongWasLastDownloaded(song.id);
          if (shouldContinue || consecutiveUpToDates < 4) {
            consecutiveUpToDates++;
            continue;
          }
          console.log('Found five consecutive songs that were up to date. Stopping execution.');
          console.log('To prevent this from happening, run with the --continue flag.');
          break AllDoLoop;
        }

        // if we reach here, that means we should reset the counter of consecutive up to dates
        consecutiveUpToDates = 0;

        try {
          await this.downloadSongToUserDirectory(song);
          this.setWhenSongWasLastDownloaded(song.id);
        } catch (e) {
          console.log('Error encountered:');
          console.log(e);
        }
      }
    } while (response.links.next);
    console.log('=====================');
    console.log('Done!');
  }

  /**
   * Iterates through every song for a user since the last execution time and downloads them
   * @param userId - userId to download
   * @param shouldContinue - default false. if true, will not short-circuit execution when 5 up to date songs are encountered
   */
  async downloadUser(userId, shouldContinue) {
    console.log(`Downloading ${userId}'s songs.`);
    // grab the last time this script was ran

    let response;
    let consecutiveUpToDates = 0;
    UserDoLoop:
    do {
      // fetch the songs
      response = (await axios.get(response ? response.links.next : `users/${userId}/songs?sort=uploaded`)).data;
      for (let i = 0; i < response.data.length; i++) {
        let song = response.data[i];
        console.log('=====================');
        console.log(`Song: ${song.title} - ${song.artist}`);

        if (song.mojibake) {
          console.log('Zip file is marked as producing mojibake. Skipping.');
          continue;
        }

        let lastDownloaded = this.getWhenSongWasLastDownloaded(song.id);
        if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
          // we're up to date! break out.
          console.log('Already up to date! Skipping.');
          this.setWhenSongWasLastDownloaded(song.id);

          if (shouldContinue || consecutiveUpToDates < 4) {
            consecutiveUpToDates++;
            continue;
          }
          console.log('Found five consecutive songs that were up to date. Stopping execution.');
          console.log('To prevent this from happening, run with the --continue flag.');
          break UserDoLoop;
        }

        // if we reach here, that means we should reset the counter of consecutive up to dates
        consecutiveUpToDates = 0;

        try {
          await this.downloadSongToUserDirectory(song);
          this.setWhenSongWasLastDownloaded(song.id);
        } catch (e) {
          console.log('Error encountered:');
          console.log(e);
        }
      }
    } while (response.links.next);
    console.log('=====================');
    console.log('Done!');
  }

  /**
   * Downloads a specific song
   * @param songId - id of the song to download
   */
  async downloadSong(songId) {
    console.log(`Downloading song ${songId}.`);

    try {
      const song = (await axios.get(`songs/${songId}`)).data.data;

      console.log('=====================');
      console.log(`Song: ${song.title} - ${song.artist}`);

      if (song.mojibake) {
        console.log('Zip file is marked as producing mojibake. Skipping.');
        continue;
      }

      let lastDownloaded = this.getWhenSongWasLastDownloaded(songId);
      if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
        // we're up to date! break out.
        console.log('Already up to date!');
      } else {
        await this.downloadSongToUserDirectory(song);
      }

      this.setWhenSongWasLastDownloaded(songId);
      console.log('=====================');
      console.log('Done!');
    } catch (e) {
      console.log('Error encountered:');
      console.log(e);
    }
  }

  /**
   * Given a song object, write it to disk
   */
  async downloadSongToUserDirectory(songObj) {
    return new Promise(async (resolve, reject) => {
      this.createUserDirectory(songObj.user);

      const userDirectoryName = this.getUserDirectoryName(songObj.user);

      if (fs.existsSync(path.resolve(`./nautica/${userDirectoryName}/${songObj.title} - ${songObj.artist}`))) {
        console.log(`${songObj.title} - ${songObj.artist} already exists. Deleting to re-download.`);

        rimraf.sync(path.resolve(`./nautica/${userDirectoryName}/${songObj.title} - ${songObj.artist}`));
      }

      const songZipName = this.cleanName(`${songObj.id}.zip`);

      console.log(`Downloading ${songObj.title} - ${songObj.artist}`);

      let data;
      try {
        data = (await axios.get(`songs/${songObj.id}/download`, {
          baseURL: base,
          responseType: 'arraybuffer'
        })).data;
      } catch (e) {
        console.log('Error encountered when downloading the zip file');
        console.log(e);
        resolve();
        return;
      }

      fs.writeFileSync(path.resolve(`./nautica/${userDirectoryName}/${songZipName}`), data)

      console.log(`Finished downloading ${songObj.title} - ${songObj.artist}. Extracting...`);

      fs.mkdirSync(path.resolve(`./nautica/${userDirectoryName}/${songObj.id}`));

      try {
        this.extractSync(
          path.resolve(`./nautica/${userDirectoryName}/${songZipName}`),
          path.resolve(`./nautica/${userDirectoryName}/${songObj.id}`)
        );
      } catch (e) {
        console.log(e);
        console.log(`Error encountered when extracting ${songZipName}`);
        fs.removeSync(path.resolve(`./nautica/${userDirectoryName}/${songObj.id}`));
        resolve();
        return;
      }

      console.log(`Finished extracting ${songObj.title} - ${songObj.artist}. Deleting old zip and cleaning up...`);

      const dirFiles = fs.readdirSync(path.resolve(`./nautica/${userDirectoryName}/${songObj.id}`));
      
      // shift zips of directories up one level
      if (dirFiles.filter(x => x.endsWith('.ksh')).length === 0) {
        for (let i = 0; i < dirFiles.length; i++) {
          if (dirFiles[i] !== '__MACOSX') {
            fs.moveSync(
              path.resolve(`./nautica/${userDirectoryName}/${songObj.id}/${dirFiles[i]}`),
              path.resolve(`./nautica/${userDirectoryName}/${dirFiles[i]}`)
            );
          }
        }
        fs.removeSync(`./nautica/${userDirectoryName}/${songObj.id}`);
      }

      fs.unlinkSync(path.resolve(`./nautica/${userDirectoryName}/${songZipName}`));

      console.log(`Deleted old zip. Finished download!`);

      resolve();
    });
  }

  /**
   * Creates the nautica directory.
   */
  createNauticaDirectory() {
    if (!fs.existsSync(path.resolve('./nautica'))) {
      fs.mkdirSync(path.resolve('./nautica'));
    }
  }

  /**
   * Creates a user's directory.
   */
  createUserDirectory(user) {
    const userDirectoryName = this.getUserDirectoryName(user);

    if (!fs.existsSync(path.resolve(`./nautica/${userDirectoryName}`))) {
      fs.mkdirSync(path.resolve(`./nautica/${userDirectoryName}`));
    }
  }

  /**
   * Gets the directory name for a user. Stores it inside meta.
   */
  getUserDirectoryName(user) {
    if (!fs.existsSync(path.resolve('./nautica/meta.json'))) {
      fs.writeFileSync(path.resolve('./nautica/meta.json'), JSON.stringify({}), 'utf8');
    }

    const meta = JSON.parse(fs.readFileSync(path.resolve('./nautica/meta.json'))); 

    if (!meta.users || !meta.users[user.id]) { 
      console.log('New user found, adding to list of users');

      if (!meta.users) {
        meta.users = {};
      }

      const userDirectoryName = this.cleanName(user.name);  
      meta.users[user.id] = userDirectoryName;
      fs.writeFileSync(path.resolve('./nautica/meta.json'), JSON.stringify(meta), 'utf8');
      return userDirectoryName;
    }

    return meta.users[user.id];
  }

  cleanName(name) {
    return name.replace("/", "-").replace(/^\./, '-');
  }

  /**
   * Gets the last time this class fetched all the songs for a user.
   * Returns null if the script was never ran before.
   */
  getWhenSongWasLastDownloaded(songId) {
    if (!fs.existsSync(path.resolve('./nautica/meta.json'))) {
      fs.writeFileSync(path.resolve('./nautica/meta.json'), JSON.stringify({
        songDownloadTimes: {}
      }), 'utf8');
      return null;
    }

    const meta = JSON.parse(fs.readFileSync(path.resolve('./nautica/meta.json')));
    return meta.songDownloadTimes[songId];
  }

  /**
   * Sets the last time this class fetched all the songs for a user.
   */
  setWhenSongWasLastDownloaded(songId) {
    const meta = JSON.parse(fs.readFileSync(path.resolve('./nautica/meta.json')));
    if (!meta.songDownloadTimes) {
      meta.songDownloadTimes = {}
    }

    meta.songDownloadTimes[songId] = moment().unix();
    fs.writeFileSync(path.resolve('./nautica/meta.json'), JSON.stringify(meta), 'utf8');
  }

  /**
   * Extracts the contents of a zip on disk to a path w/ sjis encoding
   */
  extractSync(zipFilename, basePath) {
    const zip = new AdmZip(zipFilename);
    const zipEntries = zip.getEntries();

    zipEntries.forEach(entry => {
      var pathName = iconv.decode(entry.rawEntryName, 'sjis');
      if (entry.isDirectory) {
        fs.mkdirSync(path.join(basePath, pathName));
      } else {
        mkdirp.sync(path.resolve(path.join(basePath, pathName), '..'));
        fs.writeFileSync(path.join(basePath, pathName), zip.readFile(entry));
      }
    });
  }
}

downloader = new NauticaDownloader();

const args = minimist(process.argv.slice(2));

if (args.song) {
  downloader.downloadSong(args.song);
} else if (args.user) {
  downloader.downloadUser(args.user, !!args.continue);
} else {
  downloader.downloadAll(!!args.continue);
}

