import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moduleAreaCodes, moduleMatchesArea } from "../src/config/workspaceModuleAreas.js";
import { buildWorkspaceAssociations } from "../src/pages/Settings/workspaceCatalog.js";
import * as moduleRules from "../src/config/workspaceModules.js";
import { requiresDirectModuleGrant } from "../src/config/directCrmAccess.js";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const shared = { codice: "ordini_ph", area: "old", aree: ["ph", "pr"] };

test("module arrays replace old assignments and retain legacy compatibility", () => {
 assert.deepEqual(moduleAreaCodes(shared), ["ph","pr"]);
 assert.deepEqual(moduleAreaCodes({area:"old",aree:["pr","pr"]}), ["pr"]);
 assert.deepEqual(moduleAreaCodes({area:"old",aree:[]}), []);
 assert.deepEqual(moduleAreaCodes({area:"ph"}), ["ph"]);
});
test("module filters match every area, not stale legacy area", () => {
 for(const code of ["ph","pr","all"]) assert.equal(moduleMatchesArea(shared,code),true);
 assert.equal(moduleMatchesArea(shared,"old"),false);
});
test("area cards list a module under every associated area, independently of screens", () => {
 const screen={codice:"only",area:"old"};
 const result=buildWorkspaceAssociations({modules:[shared],screens:[screen],areas:["ph","pr","old"].map(codice=>({codice}))});
 assert.deepEqual(result.areaModules.get("ph"),[shared]);
 assert.deepEqual(result.areaModules.get("pr"),[shared]);
 assert.deepEqual(result.areaModules.get("old"),[]);
 assert.deepEqual(result.areaScreens.get("old"),[screen]);
 assert.deepEqual(result.areaScreens.get("pr"),[]);
});
const authSource=read("src/contexts/AuthContext.jsx");
const decisions=authSource.slice(authSource.indexOf("  function hasModuleAccess("),authSource.indexOf("  function hasAreaAccess("));
function moduleAllowed(overrides={}) {
 const args={profile:{attivo:true},isAdmin:()=>false,getPersonalException:()=>null,requiresDirectModuleGrant,
   moduleAreas:{ordini_ph:["ph","pr"]},areaAccess:["pr"],moduleAccess:["ordini_ph"],...moduleRules,...overrides};
 return new Function(...Object.keys(args), decisions+"\nreturn hasModuleAccess('ordini_ph');")(...Object.values(args));
}
for(const [name,overrides,expected] of [
 ["second area authorizes",{},true],
 ["first area authorizes",{areaAccess:["ph"]},true],
 ["neither area denies",{areaAccess:["other"]},false],
 ["area is not itself a module assignment",{moduleAccess:[]},false],
 ["personal denial overrides both areas",{getPersonalException:()=>({decision:"nega"})},false],
 ["personal grant without areas remains valid",{areaAccess:[],getPersonalException:()=>({decision:"consenti"})},true],
 ["removed area does not linger",{moduleAreas:{ordini_ph:["ph"]}},false],
 ["legacy string map remains supported",{moduleAreas:{ordini_ph:"pr"}},true],
 ["inactive user denied",{profile:{attivo:false}},false],
]) test(name,()=>assert.equal(moduleAllowed(overrides),expected));

test("picker, catalog, payload and access snapshot all use multi-area data",()=>{
 assert.match(read("src/pages/Settings/ModuleManagement.jsx"), /aree: moduleAreaCodes\(form\)/);
 assert.match(read("src/pages/Settings/ModuleManagement.jsx"), /<ScreenAreaPicker module/);
 assert.match(authSource,/snapshot.module_area_codes \|\| snapshot.module_areas/);
 assert.match(read("src/pages/Settings/MenuManagement.jsx"),/icona,area,aree,attivo/);
 for (const file of ["AccessRules.jsx","AccessUsers.jsx"]) assert.match(read("src/pages/Settings/"+file),/nome,area,aree,attivo/);
});
test("database guards secondary associations and uses any authorized area",()=>{
 const sql=read("supabase/migrations/20260912213000_workspace_multiple_module_areas.sql");
 assert.match(sql,/m.aree && public.workspace_area_access_codes/);
 assert.match(sql,/workspace_moduli_aree/);
 assert.match(sql,/on update restrict on delete restrict/);
 assert.match(sql,/aree=excluded.aree/);
 assert.match(sql,/if not public.workspace_user_is_admin/);
 assert.match(sql,/'module_area_codes'/);
 assert.match(sql,/'module_areas'/);
});
