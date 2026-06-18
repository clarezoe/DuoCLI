// Prints the build version derived from git: <major>.<minor>.<commitCount>.
// Used by build:mac so the version is unique per commit and never hand-picked.
const { execSync } = require('node:child_process');
const pkg = require('../package.json');

const parts = String(pkg.version || '1.2.0').split('.');
const major = parts[0] || '1';
const minor = parts[1] || '2';

let count = '0';
try { count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim() || '0'; } catch { /* not a git repo */ }

process.stdout.write(`${major}.${minor}.${count}`);
