#!/usr/bin/env python3
"""Construit l'app CŌNE autonome (docs/index.html du dépôt) à partir de la source de l'artifact.
Usage : python3 build.py <cone-app.html> <dossier de sortie>"""
import sys, re, pathlib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
out = pathlib.Path(sys.argv[2])
import json
here = pathlib.Path(__file__).parent
cfg = here / "supabase.json"   # {"url": "...", "key": "<clé publique anon>"} ; absent = données sur l'appareil seulement
sb = json.loads(cfg.read_text()) if cfg.exists() else None
shim = ("window.CONE_SB=" + json.dumps(sb) + ";\n" if sb else "") + (here / "sync.js").read_text(encoding="utf-8") + "\n" + (here / "shim.js").read_text(encoding="utf-8")

# 1. retirer l'enveloppe ajoutée par la publication claude.ai (1re ligne)
first, rest = src.split("\n", 1)
if first.startswith("<!doctype html><html><head>") and "<body>" in first:
    src = rest
src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
src = re.sub(r"\n</body></html>\s*$", "\n", src)

def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        sys.exit(f"Attendu {count}x, trouvé {n}x : {old[:70]!r}")
    src = src.replace(old, new)

# 2. photos : URL locale au lieu de /_blob/ de claude.ai
src, n = re.subn(r'"/_blob/"\+(\w+)\.id', r'__bsrc(\1.id)', src)
assert n >= 5, n

# 3. textes qui renvoyaient vers claude.ai
rep('Vérifiez que vous êtes connecté à claude.ai, puis réessayez.', 'Réessayez.')
rep('const banner=online?"":`', 'const banner=online?(window.__coneSA?window.__coneSA.banner():""):`')
rep('Téléchargement indisponible ici : ouvrez l\'app depuis claude.ai.', 'Téléchargement indisponible.')
rep('<span class="small">Ouvrez l\'app depuis claude.ai, connecté, pour scanner des documents.</span>', '<span class="small">Photos indisponibles sur cet appareil.</span>')
rep('Ouvrez l\'app depuis claude.ai, connecté, pour photographier une plante.', 'Photos indisponibles sur cet appareil.')
rep('L\'identification marche dans l\'app ouverte depuis claude.ai, connecté.', 'Ajoutez votre clé Claude dans Réglages pour identifier les plantes.')
rep('"Ouvrez l\'app depuis claude.ai, connecté, pour identifier une plante."', '"Ajoutez votre clé Claude dans Réglages pour identifier une plante."')
rep('"Ouvrez l\'app depuis claude.ai, connecté."', '"Ajoutez votre clé Claude dans Réglages."')
rep('"Ouvrez l\'app depuis claude.ai, connecté, pour l\'inventaire."', '"Ajoutez votre clé Claude dans Réglages pour l\'inventaire."')
rep('vérifiez la localisation de Safari et de claude.ai.', 'vérifiez la localisation de Safari.')
rep('"Accès à Claude refusé : autorisez-le dans les permissions de l\'app."', '"Clé Claude refusée : vérifiez-la dans Réglages."')
# bannière "IA indisponible" quand aucune clé : les vues Plantes testent !online ; on ajoute un rappel
rep('<h1>Réglages</h1>', '<h1>Réglages</h1>${window.__coneSA?window.__coneSA.card():""}')

rep('Sites Safari) et pour claude.ai, ou', 'Sites Safari), ou')

# 4. en-tête : PWA plein écran
head = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#B4F500">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="CŌNE">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<script>try{var t=localStorage.getItem("cone-theme")||"light";if(t!=="auto")document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}</script>
"""
assert src.lstrip().startswith("<title>"), src[:80]
src = head + src.lstrip()
rep("<script>\n(function(){", "<script>\n" + shim + "\n</script>\n<script>\n(function(){")
src += "</body>\n</html>\n"
src = src.replace("</style>\n\n<header>", "</style>\n</head>\n<body>\n<header>", 1)
assert "<body>" in src

out.mkdir(parents=True, exist_ok=True)
(out / "index.html").write_text(src, encoding="utf-8")
print("ok", len(src))
