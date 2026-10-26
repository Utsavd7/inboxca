import Ajv from "ajv";
import draft4 from "ajv/lib/refs/json-schema-draft-04.json" with {type:"json"};
import {officialFile} from "./official.ts";

const known=new Map<string,{schema:Record<string,unknown>;validate:Ajv.ValidateFunction}>();
export function officialSchema(file:string,hash:string) {
  if(!/^[a-z0-9_./-]+\.json$/i.test(file) || file.includes("..") || file.startsWith("/")) throw new Error("Unknown official file");
  const key=`${file}:${hash}`,cached=known.get(key);if(cached) return cached;
  const bytes=officialFile(file,hash);
  const schema=JSON.parse(bytes.toString()),ajv=new Ajv({schemaId:"auto",allErrors:true,extendRefs:true,multipleOfPrecision:3,logger:false,jsonPointers:true});
  if(schema.$schema==="http://json-schema.org/draft-04/schema#") ajv.addMetaSchema(draft4);
  const validate=ajv.compile(schema);
  const entry={schema,validate};known.set(key,entry);return entry;
}
