// Packages public/ as a claude.ai Artifact in dist/artifact/.
// The Artifact host adds its own <html>/<head>/<body>, only loads scripts from approved CDNs
// and allows no external stylesheets, so: Leaflet JS comes from cdnjs, all CSS is inlined,
// and app.js, the engine and the data ship as published files next to the page.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = path.join(root, 'public');
const out = path.join(root, 'dist', 'artifact');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });
copyDir(path.join(root, 'src', 'engine'), path.join(out, 'engine'));
copyDir(path.join(pub, 'data'), path.join(out, 'data'));
copyDir(path.join(pub, 'vendor', 'leaflet', 'images'), path.join(out, 'vendor', 'leaflet', 'images'));
fs.copyFileSync(path.join(pub, 'app.js'), path.join(out, 'app.js'));

const leafletCss = fs.readFileSync(path.join(pub, 'vendor', 'leaflet', 'leaflet.css'), 'utf8')
  .replace(/url\(images\//g, 'url(vendor/leaflet/images/');
const appCss = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/<script src="vendor\/leaflet\/leaflet\.js"><\/script>/,
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>');
if (!body.includes('cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/')) throw new Error('Leaflet script tag not found in index.html');

const page = `<title>PWC Zones</title>
<style>
${leafletCss}
${appCss}
</style>
${body.trim()}
`;
fs.writeFileSync(path.join(out, 'index.html'), page);

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p !== path.join(out, 'index.html')) files.push(path.relative(out, p));
  }
};
walk(out);
fs.writeFileSync(path.join(root, 'dist', 'artifact-files.json'), JSON.stringify(files.sort(), null, 2));
console.log(`dist/artifact: index.html + ${files.length} files`);
