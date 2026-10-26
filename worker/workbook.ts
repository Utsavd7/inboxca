import {crc32,deflateRawSync} from "node:zlib";
import {xlsxEntries} from "../src/lib/sheet.ts";

// Keep the official parts and formulas. Filled sheets recalculate when opened.
export function writeWorkbook(original:Buffer,cells:Map<string,Map<string,{value:string;number:boolean}>>) {
  const parts:Buffer[]=[],directory:Buffer[]=[],paths=new Set(cells.keys());let offset=0,total=0,count=0;
  const render=(attrs:string,next:{value:string;number:boolean})=>{
    if(!next.value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(next.value)) throw new Error("Invalid workbook text");
    const text=next.value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
    if(next.number && !/^-?\d+(\.\d+)?$/.test(text)) throw new Error("Invalid workbook number");
    return next.number ? `<c${attrs}><v>${text}</v></c>` : `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  };
  for(const [name,read] of xlsxEntries(original)) {
    const updates=cells.get(name);
    // A part left as it is keeps its compressed bytes: compressing the official workbook's
    // 60 MB of unchanged sheets again took most of each fill.
    const kept=!updates && name!=="xl/workbook.xml" && read.stored?.method===8 ? read.stored : null;
    let bytes=kept ? Buffer.alloc(0) : read();total+=kept?.size ?? bytes.length;if(total>100_000_000) throw new Error("Workbook too large");
    if(updates) {
      paths.delete(name);
      const remaining=new Set(updates.keys());
      let xml=bytes.toString().replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(cell,attributes:string)=>{
        const address=/\br="([A-Z]+\d+)"/.exec(attributes)?.[1],next=address && updates.get(address);
        if(!address || !next) return cell;
        remaining.delete(address);
        const attrs=attributes.replace(/\s+t="[^"]*"/g,"");
        return render(attrs,next);
      });
      // A blank cell may be absent from the XML. Insert it in its existing row.
      const column=(name:string)=>[...name].reduce((n,char)=>n*26+char.charCodeAt(0)-64,0);
      xml=xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g,(row,attrs:string,body:string)=>{
        const number=/\br="(\d+)"/.exec(attrs)?.[1];
        const missing=[...remaining].filter(address=>/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address) && address.replace(/^[A-Z]+/,"")===number).sort((a,b)=>column(a.replace(/\d+$/,""))-column(b.replace(/\d+$/,"")));
        if(!missing.length) return row;
        for(const address of missing) {
          const before=[...body.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].find(match=>column(match[1])>column(address.replace(/\d+$/,"")));
          const at=before?.index ?? body.indexOf("<extLst"),index=at<0 ? body.length : at;
          body=body.slice(0,index)+render(` r="${address}"`,updates.get(address)!)+body.slice(index);remaining.delete(address);
        }
        return `<row${attrs}>${body}</row>`;
      });
      // A data row (5 to 1,004) below the sheet's last used row may be absent too. Add it in its place.
      const rowOf=(address:string)=>Number(address.replace(/^[A-Z]+/,""));
      for(const number of [...new Set([...remaining].filter(address=>/^[A-Z][1-9]\d{0,3}$/.test(address) && rowOf(address)>=5 && rowOf(address)<=1004).map(rowOf))].sort((a,b)=>a-b)) {
        const row=`<row r="${number}">${[...remaining].filter(address=>/^[A-Z]\d+$/.test(address) && rowOf(address)===number).sort((a,b)=>column(a.replace(/\d+$/,""))-column(b.replace(/\d+$/,""))).map(address=>{remaining.delete(address);return render(` r="${address}"`,updates.get(address)!);}).join("")}</row>`;
        const after=[...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].find(match=>Number(match[1])>number);
        xml=after ? xml.slice(0,after.index)+row+xml.slice(after.index) : xml.replace("<sheetData/>","<sheetData></sheetData>").replace("</sheetData>",`${row}</sheetData>`);
      }
      if(remaining.size) throw new Error("The official workbook does not have these cells");
      bytes=Buffer.from(xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g,cell=>/<f(?:\s|>)/.test(cell) ? cell.replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>/g,"") : cell));
    }
    if(name==="xl/workbook.xml") bytes=Buffer.from(bytes.toString().replace(/<calcPr\b[^>]*\/>/,'<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>'));
    const filename=Buffer.from(name),compressed=kept?.body ?? deflateRawSync(bytes),checksum=kept?.crc ?? crc32(bytes),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(kept?.size ?? bytes.length,22);local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);local.copy(central,6,4,30);central.writeUInt32LE(offset,42);
    parts.push(local,filename,compressed);directory.push(central,filename);offset+=local.length+filename.length+compressed.length;count++;
  }
  if(paths.size) throw new Error("The official workbook does not have these sheets");
  const end=Buffer.alloc(22),index=Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,index,end]);
}
