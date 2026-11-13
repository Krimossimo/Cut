import * as ResEdit from 'resedit'; import * as PELibrary from 'pe-library'; import * as fs from 'fs';
const exe = PELibrary.NtExecutable.from(fs.readFileSync(process.argv[2]), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
console.log(vi.getStringValues({lang:1033, codepage:1200}));
const g = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
console.log('icon groups', g.map(x => ({id:x.id, n:x.icons.length, sizes:x.icons.map(i=>i.width||256)})));
console.log('subsystem', exe.newHeader.optionalHeader.subsystem, 'machine', exe.newHeader.fileHeader.machine.toString(16));
