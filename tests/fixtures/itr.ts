import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve as filePath} from "node:path";
import catalog from "../../reference/official/templates.json";
import {templateSchema} from "../../src/lib/templates";
import type {FormRequest} from "../../src/lib/form-worker";
import type {ItrForm} from "../../src/lib/itr-fields";
import {inventedPan,itrFigures} from "../../src/lib/form-samples";

// Structure and required fields come from the pinned AY 2026-27 department schemas.
// This is an invented schema fixture, not an example of a return accepted by the portal.
export function itrRequest(form="ITR1"):FormRequest {
  const template=templateSchema.parse(catalog.find(row=>row.form_code===form));
  const schema=JSON.parse(readFileSync(filePath("reference/official",template.source.file),"utf8"));
  return {purpose:"prepare",firm:randomUUID(),client:randomUUID(),registration:randomUUID(),pan:inventedPan,period:"2026",expires:Math.floor(Date.now()/1000)+60,template,drafts:[{id:randomUUID(),revision:1,figures:itrFigures(schema,form as ItrForm)}]};
}
