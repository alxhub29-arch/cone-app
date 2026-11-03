# Construit la version web (GitHub Pages) de l'app universelle à partir de universel/app.html
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / "universel/app.html").read_text(encoding="utf-8")
head = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="L'app de chantier pour paysagistes : clients, chantiers, devis, décomptes, photos, équipe.">
<meta name="theme-color" content="#15803d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="PaysaPro">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""
(root / "docs/pro/index.html").write_text(head + app + "\n</body>\n</html>\n", encoding="utf-8")
print("docs/pro/index.html écrit")
