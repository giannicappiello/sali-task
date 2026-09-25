export function moduleScreenNavigation(catalog, pathname, preferredModule, canRead) {
 const path = pathname.replace(/\/$/, '') || '/';
 const screens = catalog.screens.filter(s => s.attiva !== false && s.percorso?.startsWith('/') && !s.percorso.startsWith('//'));
 const current = screens.filter(s => path === s.percorso.replace(/\/$/, '') || path.startsWith(`${s.percorso.replace(/\/$/, '')}/`)).sort((a,b) => b.percorso.length-a.percorso.length)[0];
 if (!current) return null;
 const parents = catalog.modules.filter(m => m.attivo !== false && catalog.links.some(l => l.modulo_codice === m.codice && l.schermata_codice === current.codice && l.visibile_menu !== false));
 const module = parents.find(m => m.codice === preferredModule) || parents.find(m => m.percorso?.replace(/\/$/, '') === path) || parents[0];
 if (!module) return null;
 const links = catalog.links.filter(l => l.modulo_codice === module.codice && l.visibile_menu !== false).sort((a,b) => (a.ordine || 0)-(b.ordine || 0));
 const initial = links.find(l => l.predefinita && screens.some(s => s.codice === l.schermata_codice && canRead(s.codice,module.codice)));
 if (!initial) return null;
 const items = links.map(l => screens.find(s => s.codice === l.schermata_codice)).filter(s => s && canRead(s.codice,module.codice));
 return { module, items };
}
