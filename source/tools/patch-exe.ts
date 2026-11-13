// Applique l'icône et les informations de version de Cut à l'exécutable Windows.
// Usage : bun patch-exe.ts <exe> <ico> <version>
import * as ResEdit from 'resedit';
import * as PELibrary from 'pe-library';
import * as fs from 'fs';

const [exePath, icoPath, version] = process.argv.slice(2);
const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);

// Icône : remplace le groupe d'icônes principal
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

// Informations de version
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [a, b, c] = version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'Cut',
  ProductName: 'Cut',
  CompanyName: 'Krimossimo',
  InternalName: 'Cut',
  OriginalFilename: 'Cut.exe',
  LegalCopyright: '© 2026 Krimossimo',
  FileVersion: version,
  ProductVersion: version,
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('patched', exePath, 'icons:', iconFile.icons.length, 'group', groupId, 'lang', lang);
