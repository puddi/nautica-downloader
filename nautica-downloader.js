const base = 'https://ksm.dev';
const onWindows = true;

const axios = require('axios').create({
  baseURL: `${base}/app`
});

const minimist = require('minimist');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const rimraf = require('rimraf');
const iconv = require('iconv-lite');
const child_process = require('child_process');
const mkdirp = require('mkdirp');

const ERROR_LOG = path.resolve('nautica/error.log');

class NauticaDownloader {
  constructor() {
    this.createNauticaDirectory();
    this.createErrorLog();
    this.createMeta();
    this.copyZipExtractor();
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
          this.logError('Error encountered:', e);
          return;
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
        console.log(`Song: ${song.artist} - ${song.title}`);

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
          this.logError('Error encountered:', e);
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
      console.log(`Song: ${song.artist} - ${song.title}`);

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
      this.logError('Error encountered:', e);
    }
  }

  /**
   * Given a song object, write it to disk
   */
  async downloadSongToUserDirectory(songObj) {
    return new Promise(async (resolve, reject) => {
      this.createUserDirectory(songObj.user);

      const userDirectoryName = this.getUserDirectoryName(songObj.user);

      const song = this.cleanName(`${songObj.artist} - ${songObj.title}`);
      const songZipName = this.cleanName(`${songObj.id}.zip`);

      console.log(`Downloading ${song}`);

      let data;
      try {
        data = (await axios.get(`songs/${songObj.id}/download`, {
          baseURL: base,
          responseType: 'arraybuffer'
        })).data;
      } catch (e) {
        this.logError('Error encountered when downloading the zip file', e);
        resolve();
        return;
      }

      fs.writeFileSync(path.resolve(`./nautica/${songZipName}`), data)

      console.log(`Finished downloading ${song}. Extracting...`);

      const songFolder = path.resolve(`./nautica/${userDirectoryName}/${song}`);
      if (!fs.existsSync(songFolder))
        fs.mkdirSync(songFolder);
      
      try {
        await this.extract(
          path.resolve(`./nautica/${songZipName}`),
          path.resolve(songFolder)
        );
      } catch (e) {
        this.logError(`Error encountered when extracting ${songZipName} to ${songFolder}`, e);
        resolve();
        return;
      }

      console.log(`Finished extracting ${song}. Deleting old zip and cleaning up...`);

      fs.unlinkSync(path.resolve(`./nautica/${songZipName}`));

      console.log(`Deleted old zip. Finished download!`);

      await this.flattenSongFolder(songFolder, songObj.id);

      resolve();
    });
  }

  /**
   * Creates the nautica directory.
   */
  createNauticaDirectory() {
    if (!fs.existsSync(path.resolve('./nautica'))) {
      console.log('Creating nautica directory...');
      fs.mkdirSync(path.resolve('./nautica'));
    }
  }

  createErrorLog() {
    if (!fs.existsSync(ERROR_LOG))
      fs.createFileSync(ERROR_LOG);
    else
      fs.truncateSync(ERROR_LOG);
  }

  createMeta() {
    if (!fs.existsSync(path.resolve('./nautica/meta.json')))
      this.writeMeta({
        songDownloadTimes: {},
        users: {},
        windowsZipExtractor: '7zip',
      });
  }

  /**
   * Copies the Unar file.
   */
  copyZipExtractor() {
    if (!fs.existsSync(path.resolve('./nautica'))) {
      this.logError('nautica directory does not exist');
      return;
    }
    if (onWindows) {
      if (!fs.existsSync(path.resolve('./nautica/7za.exe'))) {
        console.log('Writing files for extracting zips...');
        fs.writeFileSync(path.resolve('./nautica/7za.exe'), fs.readFileSync(path.join(__dirname, './assets/7za.exe')));
        fs.chmodSync(path.resolve('./nautica/7za.exe'), "755");
      }
      if (!fs.existsSync(path.resolve('./nautica/unar.exe'))) {
        fs.writeFileSync(path.resolve('./nautica/unar.exe'), fs.readFileSync(path.join(__dirname, './assets/unar.exe')));
        fs.chmodSync(path.resolve('./nautica/unar.exe'), "755");
      }
      if (!fs.existsSync(path.resolve('./nautica/Foundation.1.0.dll'))) {
        fs.writeFileSync(path.resolve('./nautica/Foundation.1.0.dll'), fs.readFileSync(path.join(__dirname, './assets/Foundation.1.0.dll')));	
        fs.chmodSync(path.resolve('./nautica/Foundation.1.0.dll'), "755");	
      }
    } else {
      if (!fs.existsSync(path.resolve('./nautica/unar'))) {
        console.log('Writing files for extracting zips...');
        fs.writeFileSync(path.resolve('./nautica/unar'), fs.readFileSync(path.join(__dirname, './assets/unar')));
        fs.chmodSync(path.resolve('./nautica/unar'), "755");
      }
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
    const meta = this.readMeta();

    if (!meta.users[user.id]) {
      console.log('New user found, adding to list of users');

      const userDirectoryName = this.cleanName(user.name);  
      meta.users[user.id] = userDirectoryName;
      this.writeMeta(meta);
      return userDirectoryName;
    }

    return meta.users[user.id];
  }

  cleanName(name) {
    const unixCleanedName = name.replace(/[/"]/g, "-").replace(/^[\.\* ]/, '-').replace(/[\*\. ]$/, '-');
    if (!onWindows) {
      return unixCleanedName;
    }
    return unixCleanedName.replace(/[<>:|?*\\]/g, "-");
  }

  /**
   * Gets the last time this class fetched all the songs for a user.
   * Returns null if the script was never ran before.
   */
  getWhenSongWasLastDownloaded(songId) {
    return this.readMeta().songDownloadTimes[songId];
  }

  /**
   * Sets the last time this class fetched all the songs for a user.
   */
  setWhenSongWasLastDownloaded(songId) {
    const meta = this.readMeta();

    meta.songDownloadTimes[songId] = moment().unix();
    this.writeMeta(meta);
  }
  
  switchWindowsZipExtractor() {
    const meta = this.readMeta();

    if (meta.windowsZipExtractor === '7zip') {
      meta.windowsZipExtractor = 'unar';
      console.log('Now using unar for extracting files on windows');
    } else {
      meta.windowsZipExtractor = '7zip';
      console.log('Now using 7zip for extracting files on windows');
    }

    this.writeMeta(meta);
  }

  /**
   * Extracts the contents of a zip on disk to a path w/ sjis encoding
   */
  extract(zipFilename, basePath) {
    return new Promise((resolve, reject) => {
      const extractResultCallback = (error, stdout, stderr) => {
        console.log(stdout);
        if (error) {
          this.logError('Error encountered:', stderr);
          reject(error);
        } else {
          resolve();
        }
      }
      
      if (onWindows && this.readMeta().windowsZipExtractor === '7zip') {
          const sevenZipPath = path.resolve('./nautica/7za.exe');
          child_process.exec(`"${sevenZipPath}" x -o"${basePath}" -aoa -r "${zipFilename}"`, {
            cwd: basePath,
            windowsHide: true,
          }, extractResultCallback);
      } else {
        const unarPath = onWindows ? path.resolve('./nautica/unar.exe') : path.resolve('./nautica/unar');
        child_process.exec(`"${unarPath}" "${zipFilename}" -o "${basePath}" -f`, {
          cwd: basePath,
          windowsHide: true,
        }, extractResultCallback);
      }
    });
  }

  flattenSongFolder(folder, songId) {
    const dirEntries = fs.readdirSync(folder, { withFileTypes: true });
    if (dirEntries.length !== 1 || !dirEntries[0].isDirectory) {
      return;
    }
    return new Promise(resolve => {
      // Measure to prevent collisions when moving
      const nestedSongFolder = path.resolve(`${folder}/${songId}`);
      fs.renameSync(
        path.resolve(`${folder}/${dirEntries[0].name}`),
        nestedSongFolder
      );
      const nestedDirEntries = fs.readdirSync(nestedSongFolder);
      Promise.all(
        nestedDirEntries.map(fileName => new Promise((resolve2, reject2) =>
          fs.move(
            path.resolve(`${nestedSongFolder}/${fileName}`),
            path.resolve(`${folder}/${fileName}`),
            { overwrite: true },
            err => err ? reject2(err) : resolve2()
          )
        ))
      )
      .then(() => {
        fs.rmdirSync(nestedSongFolder);
        resolve();
      })
      .catch(err => {
        this.logError(`Error while flattening ${folder} (song id: ${songId})`, err)
        resolve();
      });
    });
  }

  logError(message, error) {
    console.error(message);
    console.error(error);
    fs.appendFileSync(ERROR_LOG, '\r\n\r\n' + message, 'utf-8');
    fs.appendFileSync(ERROR_LOG, '\r\n' + JSON.stringify(error, null, 2), 'utf-8');
  }

  readMeta() {
    return JSON.parse(fs.readFileSync(path.resolve('./nautica/meta.json')));
  }

  writeMeta(contents) {
    fs.writeFileSync(path.resolve('./nautica/meta.json'), JSON.stringify(contents), 'utf8');
  }
}

downloader = new NauticaDownloader();

const args = minimist(process.argv.slice(2));

if (args['switch-windows-zip-extractor']) {
  downloader.switchWindowsZipExtractor();
  return;
}

if (args.song) {
  downloader.downloadSong(args.song);
} else if (args.user) {
  downloader.downloadUser(args.user, !!args.continue);
} else {
  downloader.downloadAll(!!args.continue);
}
