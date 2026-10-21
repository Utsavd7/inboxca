// Structure: GSTN GSTR2B Get All Details v4.5 response schema, pinned in reference/official/gstn.
// All values and tax numbers here are invented, not a taxpayer's download.
export function inventedGstin(pan="ZZZPZ0001Z",entity="1") {
  const alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",base=`24${pan}${entity}Z`;
  const sum=[...base].reduce((sum,char,index)=>{const value=alphabet.indexOf(char)*(index%2 ? 2 : 1);return sum+Math.floor(value/36)+value%36;},0);
  return base+alphabet[(36-sum%36)%36]; // ggignore: invented GSTIN with a valid check character.
}
export function statement(gstin=inventedGstin()) {
  return {chksum:"inventedstatement",data:{gstin,rtnprd:"092026",version:"1.0",itcsumm:{itcavl:{nonrevsup:{igst:100,cgst:20,sgst:20,cess:0,b2b:{igst:100,cgst:20,sgst:20,cess:0}}}},docdata:{b2b:[]}}};
}
