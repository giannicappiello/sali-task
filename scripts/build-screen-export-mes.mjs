import { pathToFileURL, fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
const {build} = await import(pathToFileURL(workspace+'/node_modules/vite/dist/node/index.js'));
await build({configFile:false,root:workspace,build:{outDir:process.argv[2] || workspace+'/artifacts/screen-export-mes',emptyOutDir:true,minify:true,lib:{entry:workspace+'/scripts/screen-export/mes-entry.js',formats:['es'],fileName:()=> 'report-export.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
