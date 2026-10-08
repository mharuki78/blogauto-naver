const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const manifest = require('../extension/manifest.json');
const base = '91982a28eeb5790af7a900d081a80980d6043b0c';
const read = file => fs.readFileSync(path.join(root, file));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const walk = directory => fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
  const file = path.join(directory, entry.name);
  assert.equal(entry.isSymbolicLink(), false, `Unexpected resource symlink: ${file}`);
  return entry.isDirectory() ? walk(file) : [file];
});

test('desktop and install bundle include every extension resource and upstream notice', () => {
  assert.ok(pkg.build.files.includes('extension/**/*'), 'desktop route helper must exist in app.asar');
  for (const name of ['extension', 'UPSTREAM_NOTICES.md']) {
    assert.ok(pkg.build.extraResources.some(entry => entry.from === name && entry.to === name), `missing extra resource ${name}`);
  }
  const background = read('extension/background.js').toString();
  const scripts = [...background.matchAll(/['"]([^'"]+\.js)['"]/g)].map(match => match[1]);
  const referenced = [manifest.background.service_worker, ...scripts,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(entry => entry.js), 'connect.html', 'connect.css', 'connect.js'];
  for (const resource of new Set(referenced)) assert.ok(read(`extension/${resource}`).length, resource);
});

test('release identity matches and all original Himawari assets remain byte-identical', () => {
  assert.equal(pkg.version, '0.2.0');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.version, '0.3.17');
  for (const file of ['extension/editor.js', 'extension/tistory.js', 'src/lib/desktopPublisher.js']) {
    assert.match(read(file).toString(), /20261008\.1/, file);
  }
  for (const file of ['src/assets/app-icon.ico', 'src/assets/app-icon.png', 'src/assets/himawari-logo.png']) {
    const original = execFileSync('git', ['show', `${base}:${file}`], {cwd:root, maxBuffer:5*1024*1024});
    assert.equal(digest(read(file)), digest(original), file);
  }
  for (const file of ['src/lib/naverPublisher.js', 'src/lib/tistoryPublisher.js']) {
    const original = execFileSync('git', ['show', `${base}:${file}`], {cwd:root, maxBuffer:5*1024*1024});
    assert.equal(read(file).toString().replace(/\r\n/g,'\n'), original.toString().replace(/\r\n/g,'\n'), file);
  }
});

const assertPrivateFilesAbsent = files => {
  const forbidden = /(?:^|[\\/])(?:auth\.json|user-settings\.json|account-categories\.json|extension-connections\.json|extension-tasks\.json|\.env(?:\..*)?|browser-profiles?|account-chrome|chrome-shortcuts|account-assets)(?:$|[\\/])/i;
  for (const file of files) assert.doesNotMatch(file, forbidden, `Private state in package: ${file}`);
};
test('template and extension contain static files only, without credentials or profiles', () => {
  const template = walk(path.join(root, 'runtime-template')).map(file => path.relative(path.join(root,'runtime-template'), file));
  assert.deepEqual(template, ['.gitkeep']);
  assertPrivateFilesAbsent(walk(path.join(root, 'extension')));
});

if (process.argv.includes('--packaged')) test('built app and extension match reviewed source and contain no private runtime', () => {
  const asar = require('@electron/asar');
  const resources = path.join(root, 'dist', 'win-unpacked', 'resources');
  const archive = path.join(resources, 'app.asar');
  for (const directory of ['src', 'extension']) for (const file of walk(path.join(root, directory))) {
    const relative = path.relative(root, file);
    assert.equal(digest(asar.extractFile(archive, relative)), digest(fs.readFileSync(file)), relative);
    if (directory === 'extension') assert.equal(digest(fs.readFileSync(path.join(resources, relative))), digest(fs.readFileSync(file)), relative);
  }
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, pkg.version);
  assert.equal(digest(fs.readFileSync(path.join(resources, 'UPSTREAM_NOTICES.md'))), digest(read('UPSTREAM_NOTICES.md')));
  assertPrivateFilesAbsent(asar.listPackage(archive));
  assertPrivateFilesAbsent(walk(resources).map(file => path.relative(resources, file)));
});
