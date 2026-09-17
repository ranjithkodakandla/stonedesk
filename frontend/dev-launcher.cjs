process.chdir(__dirname);
process.argv = [process.argv[0], process.argv[1]];
import(require('url').pathToFileURL(require('path').join(__dirname, 'node_modules/vite/bin/vite.js')).href);
