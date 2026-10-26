// Structure: GSTN GSTR2B Get All Details v4.5 response schema, pinned in reference/official/gstn.
// All values and tax numbers here are invented, not a taxpayer's download.
export function inventedGstin(pan="ZZZPZ0001Z",entity="1") {
  const alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",base=`24${pan}${entity}Z`;
  const sum=[...base].reduce((sum,char,index)=>{const value=alphabet.indexOf(char)*(index%2 ? 2 : 1);return sum+Math.floor(value/36)+value%36;},0);
  return base+alphabet[(36-sum%36)%36]; // ggignore: invented GSTIN with a valid check character.
}
export function statement(gstin=inventedGstin(),docdata:Record<string,unknown>={b2b:[]}) {
  return {chksum:"inventedstatement",data:{gstin,rtnprd:"092026",version:"1.0",itcsumm:{itcavl:{nonrevsup:{igst:100,cgst:20,sgst:20,cess:0,b2b:{igst:100,cgst:20,sgst:20,cess:0}}}},docdata}};
}
// One supplier's invoices (docdata b2b) or notes (docdata cdnr, typ C or D) for statement().
type Bill={number:string;dt:string;txval:number;igst?:number;cgst?:number;sgst?:number;cess?:number;typ?:"C"|"D"};
const bill=(one:Bill)=>{
  const tax={igst:one.igst ?? 0,cgst:one.cgst ?? 0,sgst:one.sgst ?? 0,cess:one.cess ?? 0};
  return {dt:one.dt,val:Math.round(100*(one.txval+tax.igst+tax.cgst+tax.sgst+tax.cess))/100,pos:"24",rev:"N",itcavl:"Y",txval:one.txval,...tax};
};
export const supplierInvoices=(ctin:string,bills:Bill[])=>({ctin,trdnm:"INVENTED SUPPLIER",supfildt:"11-10-2026",supprd:"092026",inv:bills.map((one)=>({inum:one.number,typ:"R",...bill(one)}))});
export const supplierNotes=(ctin:string,bills:Bill[])=>({ctin,trdnm:"INVENTED SUPPLIER",supfildt:"11-10-2026",supprd:"092026",nt:bills.map((one)=>({ntnum:one.number,typ:one.typ ?? "C",suptyp:"R",...bill(one)}))});
// Structure: GSTN GSTR2A v2.3 response schema (B2B), with the download's own gstin and fp as the drop box reads them.
export function gstr2a(gstin=inventedGstin()) {
  return {gstin,fp:"092026",b2b:[{ctin:inventedGstin("ZZZPZ0002Z"),cfs:"Y",inv:[{chksum:"inventedinvoice",inum:"INV-1",idt:"05-09-2026",val:1180,pos:"24",rchrg:"N",inv_typ:"R",itms:[{num:1,itm_det:{txval:1000,rt:18,camt:90,samt:90,csamt:0}}]}]}]};
}
