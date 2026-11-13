"""Génère les commandes NSIS qui suppriment exactement les fichiers installés (rien d'autre)."""
import os, sys
stage = sys.argv[1]
files, dirs = [], []
for root, dnames, fnames in os.walk(stage):
    rel = os.path.relpath(root, stage)
    for f in fnames:
        p = f if rel == '.' else os.path.join(rel, f)
        files.append(p.replace('/', '\\'))
    if rel != '.':
        dirs.append(rel.replace('/', '\\'))
for f in sorted(files):
    print(f'  Delete "$INSTDIR\\{f}"')
for d in sorted(dirs, key=lambda d: -d.count('\\')):
    print(f'  RMDir "$INSTDIR\\{d}"')
