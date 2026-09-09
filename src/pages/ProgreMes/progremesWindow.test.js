import test from "node:test";
import assert from "node:assert/strict";
import { isProgremesPopup, markProgremesPopup, PROGREMES_POPUP_PARAM } from "./progremesWindow.js";

test("marca le destinazioni ProgreMES da aprire in una scheda dedicata", () => {
  const marked = markProgremesPopup("/produzione/progremes.Planning?odpId=42#piano");
  assert.equal(marked, `/produzione/progremes.Planning?odpId=42&${PROGREMES_POPUP_PARAM}=1#piano`);
  assert.equal(isProgremesPopup(new URL(marked, "https://workspace.invalid").search), true);
  assert.equal(isProgremesPopup("odpId=42"), false);
});
