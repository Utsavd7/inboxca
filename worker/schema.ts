import Ajv from "ajv";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const known=new Map<string,{schema:Record<string,unknown>;validate:Ajv.ValidateFunction}>();
export function officialSchema(file:string,hash:string) {
  if(!/^[a-z0-9_./-]+\.json$/i.test(file) || file.includes("..") || file.startsWith("/")) throw new Error("Unknown official file");
  const key=`${file}:${hash}`,cached=known.get(key);if(cached) return cached;
  const bytes=readFileSync(new URL(`../reference/official/${file}`,import.meta.url));
  if(createHash("sha256").update(bytes).digest("hex")!==hash) throw new Error("The official file changed");
  const schema=JSON.parse(bytes.toString()),validate=new Ajv({schemaId:"auto",allErrors:true,extendRefs:true,multipleOfPrecision:3,logger:false}).compile(schema);
  const entry={schema,validate};known.set(key,entry);return entry;
}
