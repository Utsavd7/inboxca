// One readable layout for both the source images and its field locations.
export function jsonSource(value:unknown) {
  const lines:string[]=[],positions=new Map<string,number>();let limited=false;
  const write=(value:unknown,path:string,depth:number,prefix="",comma="")=>{
    if(lines.length>=1200 || depth>40) {limited=true;return;}
    const indent="  ".repeat(depth);
    if(value!==null && typeof value==="object") {
      const array=Array.isArray(value),entries=Object.entries(value);
      lines.push(indent+prefix+(array ? "[" : "{"));
      for(let index=0;index<entries.length;index++) {
        if(limited) break;
        const [key,item]=entries[index];
        write(item,`${path}/${key.replaceAll("~","~0").replaceAll("/","~1")}`,depth+1,array ? "" : `${JSON.stringify(key)}: `,index===entries.length-1 ? "" : ",");
      }
      if(lines.length<1200) lines.push(indent+(array ? "]" : "}")+comma);else limited=true;
    } else {lines.push(indent+prefix+JSON.stringify(value)+comma);positions.set(path,lines.length);}
  };
  write(value,"",0);return {lines,positions,limited};
}
