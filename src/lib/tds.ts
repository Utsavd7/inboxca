import {z} from "zod";
import {hundredths,type Figure} from "./datasets.ts";
import {date,sameHeadings} from "./sales-register.ts";
import {cleanNumber,isPan} from "./identifiers.ts";
import type {Layout} from "./official-layout.ts";

// Form No. 140 (was Form 26Q): the quarterly TDS statement for payments other than salary, under
// the Income-tax Act, 2025 (PLAN.md "TDS returns", 4 Nov 2026). InboxCA prepares the file; the CA
// validates it with Protean's free File Validation Utility (FVU) and files it. Every record, field,
// rule and code list below is from Protean's "File Format for Form Number 140 Q1 to Q4 Version
// 1.2" of 22 Jul 2026, sheet "File Format_R" (row numbers given as "row N"), downloaded from
// https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html, SHA-256
// ec5d8a1138ac84fd5ed59f62aabb5b097479007d501cca98a27ba9c400a05f40, with Form No. 140 itself
// (Rules 2026, SHA-256 db4a27ea23eafccdf9b8b434acebcd08d52cee863518e023a0bdfcb10d4b8729).
// Neither file is kept in the repository.
export const form140={code:"TDS140",version:"1.2",name:"Form No. 140"} as const;
// The other statements of Rule 219(1) are prepared the same way, each only from its own format of
// 22 Jul 2026 on the same page (version 1.2 on the page; the title row of each still says 1.1),
// read with its own Form, none kept in the repository: "File Format for Form Number 138 Q1 to Q3"
// (SHA-256 d58fd86b69932c6a7a4f518990c17d2112f55c65042d9c3bf2799ed201cbaf6c, Form No. 138
// b76e3d0cb5c5fff33dc59cd6ae92ca738a0b52c2e07a936f48f6e6eba45545b5), "... 144 Q1 to Q4"
// (5e78534c065133936a4bb594f310c10a44e25a0825fe9f7ff023b342730fd5da, Form No. 144
// aa852a34c87dcb841454637e263ac09219411bb64577de7d93d72b1784f47b24) and "... 143 Q1 to Q4"
// (c487ddd78125433aefc4063ccb93ebe820156c42e1d2a58986ae110c50fc51a7, Form No. 143
// e02962471322e53f3eb7e43da87f123b431069d7f01661b7411940ad037dbe51). Rule 219(1): Form No. 138
// for salary, 144 for payments to non residents, 140 for other payments, 143 for tax collected
// under section 394(1). Rows below are of each form's own sheet. Form No. 138 for the fourth
// quarter (with each employee's salary details) waits for its format, not yet published.
// Each form's file was also run through Protean's TDS_STANDALONE_FVU_1.2.zip (SHA-256
// 21f7a5a45b42cdd2c952aa633a0049d6c81612e87d43d1d02720bd781943c06d, 5 Nov 2026, not kept); the
// rules it enforces beyond the sheets are cited below by its error code.
export type TdsForm="TDS140"|"TDS138"|"TDS144"|"TDS143";
export const tdsForms={
  TDS140:{number:"140",was:"26Q",about:"TDS on payments other than salary",fileType:"NS1",kind:"payments",who:"deductor",payee:"deductee",tax:"deducted",example:"1024 for contractors and 1027 for professional fees",sha256:"ec5d8a1138ac84fd5ed59f62aabb5b097479007d501cca98a27ba9c400a05f40",task:"TDS_RET"},
  TDS138:{number:"138",was:"24Q",about:"TDS on salary",fileType:"SL1",kind:"salaries",who:"deductor",payee:"employee",tax:"deducted",example:"1002 for employees other than Government employees",sha256:"d58fd86b69932c6a7a4f518990c17d2112f55c65042d9c3bf2799ed201cbaf6c",task:"TDS_RET"},
  TDS144:{number:"144",was:"27Q",about:"TDS on payments to non residents",fileType:"NS1",kind:"nonresident",who:"deductor",payee:"deductee",tax:"deducted",example:"1057 for interest and other sums and 1050 for mutual fund income",sha256:"5e78534c065133936a4bb594f310c10a44e25a0825fe9f7ff023b342730fd5da",task:"TDS_RET"},
  TDS143:{number:"143",was:"27EQ",about:"TCS, tax collected at source",fileType:"TC1",kind:"collections",who:"collector",payee:"collectee",tax:"collected",example:"1073 for sale of scrap and 1075 for a motor vehicle",sha256:"c487ddd78125433aefc4063ccb93ebe820156c42e1d2a58986ae110c50fc51a7",task:"TCS_RET"},
} as const;
export const isTdsForm=(form:string):form is TdsForm=>Object.hasOwn(tdsForms,form);
export const tdsName=(form:TdsForm)=>`Form No. ${tdsForms[form].number}`;
// Form No. 138 Q1 to Q3 only (its row 2): the March quarter waits for Protean's Q4 format.
export const waitsForFormat=(form:TdsForm,period:string)=>form==="TDS138" && period.endsWith("-03");

// Annexure 1 and Annexure 5 (rows 204 to 239 and 367 to 402, the same list): state codes.
export const stateCodes:Record<string,string>={"01":"Andaman and Nicobar Islands","02":"Andhra Pradesh","03":"Arunachal Pradesh","04":"Assam","05":"Bihar","06":"Chandigarh","07":"Dadra & Nagar Haveli and Daman & Diu","09":"Delhi","10":"Goa","11":"Gujarat","12":"Haryana","13":"Himachal Pradesh","14":"Jammu & Kashmir","15":"Karnataka","16":"Kerala","17":"Lakshwadeep","18":"Madhya Pradesh","19":"Maharashtra","20":"Manipur","21":"Meghalaya","22":"Mizoram","23":"Nagaland","24":"Odisha","25":"Pondicherry","26":"Punjab","27":"Rajasthan","28":"Sikkim","29":"Tamil Nadu","30":"Tripura","31":"Uttar Pradesh","32":"West Bengal","33":"Chhattisgarh","34":"Uttarakhand","35":"Jharkhand","36":"Telangana","37":"Ladakh"};
// Annexure 2 (rows 243 to 282): section codes and the sections of the 2025 Act they stand for.
export const sectionCodes:Record<string,string>={"1004":"392(7)","1005":"393(1) Table Sl. No. 1(i)","1006":"393(1) Table Sl. No. 1(ii)","1008":"393(1) Table Sl. No. 2(ii).D(a)","1009":"393(1) Table Sl. No. 2(ii).D(b)","1011":"393(1) Table Sl. No. 3(ii)","1012":"393(1) Table Sl. No. 3(iii)","1013":"393(1) Table Sl. No. 4(i)","1014":"393(1) Table Sl. No. 4(ii)","1015":"393(1) Table Sl. No. 4(ii)","1016":"393(1) Table Sl. No. 4(ii)","1017":"393(1) Table Sl. No. 4(iii)","1018":"393(1) Table Sl. No. 4(iv)","1019":"393(1) Table Sl. No. 5(i)","1020":"393(1) Table Sl. No. 5(ii).D(a)","1021":"393(1) Table Sl. No. 5(ii).D(b)","1022":"393(1) Table Sl. No. 5(iii)","1023":"393(1) Table Sl. No. 6(i).D(a)","1024":"393(1) Table Sl. No. 6(i).D(b)","1026":"393(1) Table Sl. No. 6(iii).D(a)","1027":"393(1) Table Sl. No. 6(iii).D(b)","1028":"393(1) Table Sl. No. 6(iii).D(b)","1029":"393(1) Table Sl. No. 7","1030":"393(1) Table Sl. No. 8(i)","1031":"393(1) Table Sl. No. 8(ii)","1033":"393(1) Table Sl. No. 8(iv)","1034":"393(1) Table Sl. No. 8(iv) Note 6","1035":"393(1) Table Sl. No. 8(v)","1037":"393(1) Table Sl. No. 8(vi)","1038":"393(1) Table Sl. No. 8(vi) Note 6","1058":"393(3) Table Sl. No. 1","1059":"393(3) Table Sl. No. 1 Note 2","1060":"393(3) Table Sl. No. 2","1061":"393(3) Table Sl. No. 2 Note 2","1062":"393(3) Table Sl. No. 3","1063":"393(3) Table Sl. No. 4","1064":"393(3) Table Sl. No. 5.D(a)","1065":"393(3) Table Sl. No. 5.D(b)","1066":"393(3) Table Sl. No. 6","1067":"393(3) Table Sl. No. 7"};
// Annexure 3 (rows 287 to 344): ministry codes, for Central Government deductors.
export const ministryCodes:Record<string,string>={"01":"Agriculture","02":"Atomic Energy","03":"Fertilizers","04":"Chemicals and Petrochemicals","05":"Civil Aviation and Tourism","06":"Coal","07":"Consumer Affairs, Food and Public Distribution","08":"Commerce and Textiles","09":"Environment and Forests and Ministry of Earth Science","10":"External Affairs and Overseas Indian Affairs","11":"Finance","12":"Central Board of Direct Taxes","13":"Central Board of Excise and Customs","14":"Contoller of Aid Accounts and Audit","15":"Central Pension Accounting Office","16":"Food Processing Industries","17":"Health and Family Welfare","18":"Home Affairs and Development of North Eastern Region","19":"Human Resource Development","20":"Industry","21":"Information and Broadcasting","22":"Telecommunication and Information Technology","23":"Labour","24":"Law and Justice and Company Affairs","25":"Personnel, Public Grievances and Pensions","26":"Petroleum and Natural Gas","27":"Plannning, Statistics and Programme Implementation","28":"Power","29":"New and Renewable Energy","30":"Rural Development and Panchayati Raj","31":"Science And Technology","32":"Space","33":"Steel","34":"Mines","35":"Social Justice and Empowerment","36":"Tribal Affairs","37":"D/o Commerce (Supply Division)","38":"Shipping and Road Transport and Highways","39":"Urban Development, Urban Employment and Poverty Alleviation","40":"Water Resources","41":"President's Secretariat","42":"Lok Sabha Secretariat","43":"Rajya Sabha secretariat","44":"Election Commission","45":"Ministry of Defence (Controller General of Defence Accounts)","46":"Ministry of Railways","47":"Department of Posts","48":"Department of Telecommunications","49":"Andaman and Nicobar Islands Administration","50":"Chandigarh Administration","51":"Dadra and Nagar Haveli","52":"Goa, Daman and Diu","53":"Lakshadweep","54":"Pondicherry Administration","55":"Pay and Accounts Officers (Audit)","56":"Ministry of Non-conventional energy sources","57":"Government Of NCT of Delhi","99":"Others"};
// Annexure 4 (rows 348 to 363): the deductor's category.
export const deductorTypes:Record<string,string>={K:"Company",M:"Branch or division of a company",F:"Firm",Q:"Individual or HUF",P:"Association of persons (AOP)",T:"Association of persons (trust)",B:"Body of individuals",J:"Artificial juridical person",A:"Central Government",S:"State Government",D:"Statutory body (Central Government)",E:"Statutory body (State Government)",G:"Autonomous body (Central Government)",H:"Autonomous body (State Government)",L:"Local authority (Central Government)",N:"Local authority (State Government)"};
const government=new Set(["A","S","D","E","G","H","L","N"]);
// Annexure 6 (rows 405 to 589): each reason code and the section codes it may go with. A, C
// and E go with every section code of Annexure 2.
const every=Object.keys(sectionCodes).join(" ");
export const remarkSections:Record<string,string>={A:every,B:"1004 1005 1008 1009 1013 1019 1020 1021 1022 1029 1030",C:every,D:"1020 1021 1022",E:every,N:"1064 1065",O:"1015",P:"1029",Q:"1020 1021 1022",S:"1031",T:"1023 1024",Y:"1004 1005 1006 1012 1013 1019 1020 1021 1022 1023 1024 1026 1027 1029 1030 1031 1033 1034 1035 1037 1038 1058 1059 1062 1063 1066 1067",Z:"1005 1006 1008 1017 1019 1023 1024 1026 1027 1028 1029 1045 1046"};
// Annexure 7 (rows 594 to 596): the challan's minor head.
export const minorHeads:Record<string,string>={"200":"TDS payable by taxpayer","400":"TDS regular assessment (raised by the Income Tax Department)","100":"Advance tax"};
// Form No. 138, Annexure 2 (rows 240 to 245) and Annexure 6 (rows 367 to 370; A needs a PAN).
export const salarySections:Record<string,string>={"1001":"392 (Government employees other than Union Government)","1002":"392 (employees other than Government employees)","1003":"392 (Union Government employees)","1032":"393(1) Table Sl. No. 8(iii) (specified senior citizens)"};
// Form No. 144, Annexure 2 (rows 240 to 271).
export const nonResidentSections:Record<string,string>={"1004":"392(7)","1039":"393(2) Table Sl. No. 1","1040":"393(2) Table Sl. No. 2","1041":"393(2) Table Sl. No. 3","1042":"393(2) Table Sl. No. 4.E(a)","1043":"393(2) Table Sl. No. 4.E(b)","1044":"393(2) Table Sl. No. 5","1045":"393(2) Table Sl. No. 6.E(a)","1046":"393(2) Table Sl. No. 6.E(b)","1047":"393(2) Table Sl. No. 7","1048":"393(2) Table Sl. No. 8","1049":"393(2) Table Sl. No. 9","1050":"393(2) Table Sl. No. 10","1051":"393(2) Table Sl. No. 11","1052":"393(2) Table Sl. No. 12","1053":"393(2) Table Sl. No. 13","1054":"393(2) Table Sl. No. 14","1055":"393(2) Table Sl. No. 15","1056":"393(2) Table Sl. No. 16","1057":"393(2) Table Sl. No. 17","1058":"393(3) Table Sl. No. 1","1059":"393(3) Table Sl. No. 1 Note 2","1060":"393(3) Table Sl. No. 2","1061":"393(3) Table Sl. No. 2 Note 2","1062":"393(3) Table Sl. No. 3","1063":"393(3) Table Sl. No. 4","1064":"393(3) Table Sl. No. 5.D(a)","1065":"393(3) Table Sl. No. 5.D(b)","1066":"393(3) Table Sl. No. 6","1067":"393(3) Table Sl. No. 7"};
// Form No. 143, Annexure 2 (rows 240 to 266): the collection codes.
export const collectionCodes:Record<string,string>={"1068":"394(1) Table Sl. No. 1 (alcoholic liquor)","1069":"394(1) Table Sl. No. 2 (tendu leaves)","1070":"394(1) Table Sl. No. 3 (timber, forest lease)","1071":"394(1) Table Sl. No. 3 (timber, other mode)","1072":"394(1) Table Sl. No. 3 (other forest produce)","1073":"394(1) Table Sl. No. 4 (scrap)","1074":"394(1) Table Sl. No. 5 (coal, lignite or iron ore)","1075":"394(1) Table Sl. No. 6.D(a) (motor vehicle)","1076":"394(1) Table Sl. No. 6.D(b) (wrist watch)","1077":"394(1) Table Sl. No. 6.D(b) (art piece)","1078":"394(1) Table Sl. No. 6.D(b) (collectibles)","1079":"394(1) Table Sl. No. 6.D(b) (yacht, boat or helicopter)","1080":"394(1) Table Sl. No. 6.D(b) (sunglasses)","1081":"394(1) Table Sl. No. 6.D(b) (bag)","1082":"394(1) Table Sl. No. 6.D(b) (shoes)","1083":"394(1) Table Sl. No. 6.D(b) (sportswear and equipment)","1084":"394(1) Table Sl. No. 6.D(b) (home theatre)","1085":"394(1) Table Sl. No. 6.D(b) (horse)","1086":"394(1) Table Sl. No. 7.D(a) (LRS, education or medical)","1087":"394(1) Table Sl. No. 7.D(b) (LRS, other purposes)","1088":"394(1) Table Sl. No. 8.D(a) (overseas tour, up to the limit)","1089":"394(1) Table Sl. No. 8.D(b) (overseas tour, above the limit)","1090":"394(1) Table Sl. No. 9 (parking lot)","1091":"394(1) Table Sl. No. 9 (toll plaza)","1092":"394(1) Table Sl. No. 9 (mine or quarry)"};
// Annexure 8 of Forms No. 144 and 143 (rows 475 to 486 and 405 to 416, the same list): the
// deductee's status, the collectee code.
export const statusCodes:Record<string,string>={"1":"Company","2":"Individual","3":"Hindu undivided family","4":"AOP, other than of companies only","5":"AOP of companies only","6":"Cooperative society","7":"Firm","8":"Body of individuals","9":"Artificial juridical person","10":"Others"};
// Form No. 144, Annexure 9 (rows 488 to 559): the nature of remittance codes each section takes,
// in the format's order. A section not listed takes none (row 169).
export const remittances:Record<string,string>={"1040":"27","1041":"27","1042":"27","1043":"27","1044":"27","1045":"27","1046":"16 73","1048":"27 16 73 66 67 68 69 70","1049":"27 16 73 66 67 68 69 70","1050":"27 16 73 66 67 68 69 70","1051":"27 16 73","1052":"71","1053":"27 16 73","1054":"72","1055":"27 16 73 66 67 68 69 70","1056":"27 16 73 66 67 68 69 70","1057":"27 73 16 28 66 67 68 69 70 21 74 49 75 99"};
// Form No. 144, Annexure 10 (rows 562 to 848): country codes 01 to 286, with no 99.
export const countryCodes=Array.from({length:286},(_,at)=>String(at+1).padStart(2,"0")).filter(code=>code!=="99");
// What a code in a statement's figure stands for, from the annexures above, shown beside it when
// staff check the figures: a section code's section, a minor head's name, a status code's
// status. Reason, country and remittance codes have no words in the formats, so none.
const sectionsOf:Record<TdsForm,Record<string,string>>={TDS140:sectionCodes,TDS138:salarySections,TDS144:nonResidentSections,TDS143:collectionCodes};
export function tdsCodeMeaning(form:string,field:string,value:string) {
  const key=/^tds\.[pc]\d+\.([a-z_]+)$/.exec(field)?.[1],from=(table:Record<string,string>)=>Object.hasOwn(table,value) ? table[value] : "";
  if(!isTdsForm(form)) return "";
  if(key==="section") return from(sectionsOf[form]) && `Section ${from(sectionsOf[form])}`;
  if(key==="minor") return from(minorHeads);
  if(key==="status" && (form==="TDS144" || form==="TDS143")) return from(statusCodes);
  return "";
}
const pairs=(table:Record<string,string>)=>Object.entries(table).flatMap(([flag,codes])=>codes.split(" ").map(code=>`${flag} ${code}`));
// The layout this file is written to: each record's fields as "number type size mandatory"
// (rows 22 to 198) and the annexures' codes, as src/lib/official-layout.ts tdsFormatLayout reads
// them from the format. The daily forms check (src/jobs/forms-watch.ts) sets each new release of
// the format beside it: the same layout goes live by itself, a changed one waits for Orelu's admin.
const records:Record<string,string>={
  FH:"1 INTEGER 9 M|2 CHAR 2 M|3 CHAR 4 M|4 CHAR 2 M|5 DATE 8 M|6 INTEGER 9 M|7 CHAR 1 M|8 CHAR 10 M|9 INTEGER 9 M|10 CHAR 75 M|11 NA 0 NA|12 NA 0 NA|13 NA 0 NA|14 NA 0 NA|15 NA 0 NA|16 NA 0 NA|17 NA 0 NA|18 NA 0 NA",
  BH:"1 INTEGER 9 M|2 CHAR 2 M|3 INTEGER 9 M|4 INTEGER 9 M|5 CHAR 4 M|6 NA 0 O|7 NA 0 O|8 NA 0 O|9 INTEGER 15 O|10 NA 0 O|11 NA 0 O|12 NA 0 O|13 CHAR 10 M|14 CHAR 8 NA|15 CHAR 10 M|16 INTEGER 6 M|17 INTEGER 6 M|18 CHAR 2 M|19 CHAR 75 M|20 CHAR 25 M|21 CHAR 25 M|22 CHAR 25 O|23 CHAR 25 O|24 CHAR 25 O|25 CHAR 25 O|26 INTEGER 2 M|27 INTEGER 6 M|28 CHAR 75 M|29 INTEGER 5 M|30 CHAR 10 M|31 CHAR 0 O|32 CHAR 1 M|33 CHAR 75 M|34 CHAR 20 M|35 CHAR 25 M|36 CHAR 25 O|37 CHAR 25 O|38 CHAR 25 O|39 CHAR 25 O|40 INTEGER 2 M|41 INTEGER 6 M|42 CHAR 75 M|43 CHAR 25 M|44 INTEGER 5 M|45 CHAR 10 M|46 NA 0 O|47 INTEGER 15 M|48 CHAR 9 O|49 NA 0 O|50 NA 0 O|51 NA 0 O|52 CHAR 1 M|53 CHAR 1 NA|54 CHAR 2 O|55 NA 0 O|56 NA 0 O|57 CHAR 3 O|58 CHAR 150 O|59 CHAR 10 M|60 NA 0 O|61 NA 0 O|62 NA 0 O|63 NA 0 O|64 NA 0 O|65 NA 0 O|66 NA 0 O|67 NA 0 O|68 CHAR 7 O|69 CHAR 15 O|70 NA 0 O|71 NA 0 O|72 NA 0 O",
  CD:"1 INTEGER 9 M|2 CHAR 2 M|3 INTEGER 9 M|4 INTEGER 9 M|5 INTEGER 9 M|6 CHAR 1 M|7 NA 0 O|8 INTEGER 15 M|9 INTEGER 15 M|10 INTEGER 15 M|11 INTEGER 15 M|12 INTEGER 15 M|13 CHAR 1 O|14 NA 0 O|15 INTEGER 7 M|16 NA 0 O|17 INTEGER 5 O|18 NA 0 O|19 DATE 8 M|20 NA 0 O|21 DECIMAL 15 M|22 DECIMAL 15 M|23 INTEGER 3 O|24 INTEGER 15 M|25 INTEGER 15 M|26 NA 0 O|27 NA 0 O|28 NA 0 O|29 NA 0 O|30 NA 0 O",
  DD:"1 INTEGER 9 M|2 CHAR 2 M|3 INTEGER 9 M|4 INTEGER 9 M|5 INTEGER 9 M|6 CHAR 1 M|7 NA 0 O|8 CHAR 10 M|9 CHAR 75 M|10 NA 0 O|11 NA 0 O|12 NA 0 O|13 NA 0 O|14 NA 0 O|15 CHAR 4 M|16 NA 0 O|17 NA 0 O|18 CHAR 1 M|19 DATE 8 M|20 DECIMAL 15 M|21 NA 0 O|22 DECIMAL 15 O|23 DECIMAL 15 O|24 DECIMAL 15 M|25 DECIMAL 15 M|26 NA 0 O|27 DATE 8 M|28 DECIMAL 7 M|29 NA 0 O|30 NA 0 O|31 CHAR 26 O|32 CHAR 1 O|33 CHAR 15 O|34 NA 0 O|35 NA 0 O|36 NA 0 O|37 NA 0 O|38 NA 0 O|39 NA 0 O|40 NA 0 O|41 NA 0 O|42 NA 0 O|43 NA 0 O|44 NA 0 O|45 NA 0 O",
};
export const form140Layout:Layout={...Object.fromEntries(Object.entries(records).map(([key,fields])=>[key,fields.split("|")])),"Annexure 1":Object.keys(stateCodes),"Annexure 2":Object.keys(sectionCodes),"Annexure 3":Object.keys(ministryCodes),
  "Annexure 4":Object.keys(deductorTypes),"Annexure 5":Object.keys(stateCodes),"Annexure 6":Object.entries(remarkSections).flatMap(([flag,codes])=>codes.split(" ").map(code=>`${flag} ${code}`)),"Annexure 7":Object.keys(minorHeads)};

// Each reason code of the other forms and the codes it may go with: Form No. 144 Annexure 6
// (rows 393 to 467), Form No. 143 Annexure 6 (rows 388 to 396). Form No. 138 has A and C for
// every salary code (rows 369 and 370).
const salaries=Object.keys(salarySections).join(" "),abroad=Object.keys(nonResidentSections).filter(code=>!["1059","1061"].includes(code)).join(" "),collected=Object.keys(collectionCodes).join(" ");
const reasons:Record<TdsForm,Record<string,string>>={TDS140:remarkSections,TDS138:{A:salaries,C:salaries},
  TDS144:{A:abroad,C:abroad,G:"1057",H:"1056",I:"1055",N:"1064 1065",O:"1046",Y:"1004 1058 1059 1062 1063 1066 1067",Z:"1057"},
  TDS143:{A:collected,B:"1068 1069 1070 1071 1072 1073 1074",C:collected,F:"1086 1087 1088 1089",K:"1086 1087",Y:"1086 1087",Z:"1075 1076 1077 1078 1079 1080 1081 1082 1083 1084 1085"}};
// Each form's records are Form No. 140's but for the fields its own sheet sets otherwise (as
// layoutDifferences finds them): Form No. 138 rows 44 to 197, 144 rows 44 to 198, 143 rows 44 to
// 198. Form No. 144's fields 34 to 36 have no type or size in its sheet (rows 187 to 189).
const patch=(record:string,fields:Record<number,string>)=>record.split("|").map(field=>{const number=Number(field.split(" ")[0]);return number in fields ? `${number} ${fields[number]}`.trim() : field;}).join("|");
const na=(...numbers:number[])=>Object.fromEntries(numbers.map(number=>[number,"NA NA NA"]));
const recordsOf:Record<TdsForm,Record<string,string>>={TDS140:records,
  TDS138:{...records,BH:patch(records.BH,{30:"INTEGER 10 M",31:"NA 0 O",...na(48,49,50)}),DD:patch(records.DD,{22:"NA 0 O",23:"NA 0 O",28:"NA 0 O",29:"DECIMAL 7 M",31:"NA 0 O"})},
  TDS144:{...records,BH:patch(records.BH,{31:"NA 0 O"}),DD:patch(records.DD,{12:"INTEGER 2 M",14:"CHAR 1 M",16:"INTEGER 2 O",17:"INTEGER 3 M",21:"CHAR 1 M",30:"CHAR 1 M",34:"",35:"",36:"",37:"CHAR 150 O",38:"CHAR 75 O",39:"INTEGER 15 O",41:"CHAR 25 O"})},
  TDS143:{...records,BH:patch(records.BH,{31:"NA 0 O"}),DD:patch(records.DD,{11:"CHAR 1 M",12:"INTEGER 2 M",13:"CHAR 1 O",14:"CHAR 1 M",22:"NA 0 O",23:"NA 0 O",27:"DATE 8 O",31:"NA 0 O",34:"CHAR 1 O",35:"INTEGER 5 O",36:"DATE 8 O",...na(37,38,39,40,41,43,44,45)})},
};
const common={"Annexure 1":Object.keys(stateCodes),"Annexure 3":Object.keys(ministryCodes),"Annexure 4":Object.keys(deductorTypes),"Annexure 5":Object.keys(stateCodes),"Annexure 7":Object.keys(minorHeads)};
const layoutOf=(form:TdsForm,annexures:Layout):Layout=>({...Object.fromEntries(Object.entries(recordsOf[form]).map(([key,fields])=>[key,fields.split("|").filter(field=>field.includes(" "))])),...common,...annexures});
export const tdsLayouts:Record<TdsForm,Layout>={TDS140:form140Layout,
  TDS138:layoutOf("TDS138",{"Annexure 2":Object.keys(salarySections),"Annexure 6":["A Yes","C No"]}),
  TDS144:layoutOf("TDS144",{"Annexure 2":Object.keys(nonResidentSections),"Annexure 6":pairs(reasons.TDS144),"Annexure 8":Object.keys(statusCodes),"Annexure 9":Object.entries(remittances).flatMap(([section,codes])=>codes.split(" ").map(code=>`${code} ${section}`)),"Annexure 10":countryCodes}),
  TDS143:layoutOf("TDS143",{"Annexure 2":Object.keys(collectionCodes),"Annexure 6":pairs(reasons.TDS143),"Annexure 8":Object.keys(statusCodes)}),
};

// Row 161: the words written in place of a PAN the deductee has not given.
const noPans=["PANAPPLIED","PANINVALID","PANNOTAVBL"];
// Rows 161, 177, 178, 181: tax paid before release (benefits in kind, virtual digital assets,
// winnings in kind) shows no tax on the row and needs a real PAN.
const paidBefore=new Set(["1059","1034","1038","1061"]);
// Row 14: a payment under a nil challan needs a reason for no or lower deduction (all but C).
const nilReasons=new Set(["A","B","D","E","N","O","P","Q","Y","S","T","Z"]);

// The health checks below take every rate, section and date only from the Act and Rules as the
// Income Tax Department shows them, read on 5 Nov 2026; each figure is an estimate staff check,
// never a figure InboxCA changes.
// Section 393(1) Table, column D (https://www.incometaxindia.gov.in/w/section-393-5): the rate in
// hundredths of a percent for the Form No. 140 codes whose rate the code alone settles. Left out:
// "rates in force" (Sl. Nos. 1(i), 5), rates on part of a sum (8(i), 8(ii)), the trusts and funds
// (4(ii) to 4(iv)), benefits (8(iv)) and every code of section 393(3) or 392.
const actRates:Record<string,number>={
  "1006":200, // Sl. No. 1(ii): commission or brokerage, 2%.
  "1008":200,"1009":1000, // Sl. No. 2(ii): rent, (a) 2% for machinery, plant or equipment, (b) 10% for land, building or furniture.
  "1011":1000, // Sl. No. 3(ii): consideration under the agreement of section 67(14), 10%.
  "1012":1000, // Sl. No. 3(iii): compensation on compulsory acquisition, 10%.
  "1013":1000, // Sl. No. 4(i): income from units, 10%.
  "1023":100,"1024":200, // Sl. No. 6(i): contractors, (a) 1% for an individual or HUF, (b) 2% for others.
  "1026":200,"1027":1000,"1028":1000, // Sl. No. 6(iii): (a) 2% for technical services, film royalty, call centres; (b) 10% otherwise.
  "1029":1000, // Sl. No. 7: dividend, 10%.
  "1035":10, // Sl. No. 8(v): e-commerce operator, 0.1% of the gross amount.
  "1037":100, // Sl. No. 8(vi): transfer of a virtual digital asset, 1%.
};
// Section 397(2)(b) (https://www.incometaxindia.gov.in/w/section-397-5): with no valid PAN, tax is
// deducted at the higher of the Act's rate, the rates in force, or 5% for section 393(1) Table Sl.
// Nos. 8(ii) and 8(v) (codes 1031, 1035) and 20% otherwise; collected at the higher of twice the
// rate or 5%, not above 20%. So at least 20% (or 5%) on Form No. 140 and 5% on Form No. 143.
// Forms No. 138 and 144 are left out: salary below the taxable limit and the non residents of
// section 397(2)(c) take conditions InboxCA cannot see.
const noPanRate=(form:TdsForm,section:string)=>form==="TDS143" ? 500 : form==="TDS140" ? Math.max(["1031","1035"].includes(section) ? 500 : 2000,actRates[section] ?? 0) : 0;
// Rule 218(2) (https://www.incometaxindia.gov.in/w/rule-218-1): a deductor or collector other
// than an office of the Government pays tax by 30 April for March, else within seven days from
// the end of the month of deduction or collection. Rule 218(4) quarterly payment, allowed by the
// Assessing Officer in special cases, is not seen here, so the estimate says check before filing.
const payBy=(day:string)=>{const [year,month]=day.split("-").map(Number);return month===3 ? `${year}-04-30` : `${month===12 ? year+1 : year}-${String(month%12+1).padStart(2,"0")}-07`;};
// Section 398(3)(a)(ii) (https://www.incometaxindia.gov.in/w/section-398-5): simple interest at
// 1.5% for every month or part of a month from the date of deduction or collection to the date
// actually paid. A part month counts whole: 10 July to 6 September is 2 months, to 11 September 3.
const lateMonths=(from:string,to:string)=>{const [fy,fm,fd]=from.split("-").map(Number),[ty,tm,td]=to.split("-").map(Number);return Math.max(1,(ty-fy)*12+tm-fm+(td>fd ? 1 : 0));};
// Rule 219(4) (https://www.incometaxindia.gov.in/w/rule-219-1): each quarter's statement is due
// 31 July, 31 October, 31 January, and 31 May after the tax year. Section 427
// (https://www.incometaxindia.gov.in/w/section-427-5): a fee of ₹200 for every day the failure
// continues, not above the tax deductible or collectible.
const statementDue=(period:string)=>{const [year,month]=period.split("-").map(Number);return month===12 ? `${year+1}-01-31` : `${year}-${month===3 ? "05" : month===6 ? "07" : "10"}-31`;};

// The client's registers (payments, salaries, payments to non residents, collections) and its
// challan register: the columns a person matches once, as for a purchase register
// (src/lib/purchase-register.ts), remembered for the client's next one. The first fields of each
// are needed; the rest are the other fields its form's deductee or collectee record takes.
export const tdsFields={
  payments:[["pan","Deductee PAN"],["name","Deductee name"],["section","Section code"],["paid_on","Date of payment or credit"],["amount","Amount paid or credited"],["tds","Tax deducted"],["rate","Rate"],["challan","Challan serial number"],["deducted_on","Date of deduction"],["deposited","Tax deposited"],["remark","Reason code"],["certificate","Certificate number"],["form121","Form No. 121 number"],["cash","Cash withdrawn above the limit"]],
  salaries:[["pan","Employee PAN"],["name","Employee name"],["section","Section code"],["paid_on","Date of payment or credit"],["amount","Amount paid or credited"],["tds","Tax deducted"],["challan","Challan serial number"],["deducted_on","Date of deduction"],["deposited","Tax deposited"],["remark","Reason code"],["certificate","Certificate number"]],
  nonresident:[["pan","Deductee PAN"],["name","Deductee name"],["section","Section code"],["paid_on","Date of payment or credit"],["amount","Amount paid or credited"],["tds","Tax deducted"],["status","Status code"],["country","Country code"],["rate","Rate"],["dtaa","Rate under the Act (A) or DTAA (B)"],["remittance","Nature of remittance code"],["challan","Challan serial number"],["deducted_on","Date of deduction"],["deposited","Tax deposited"],["remark","Reason code"],["certificate","Certificate number"],["form121","Form No. 121 number"],["grossed","Grossed up (Y or N)"],["opted_out","Opted out of section 202(1) (Y or N)"],["cash","Cash withdrawn above the limit"],["address","Address abroad"],["email","Deductee email"],["phone","Deductee phone"],["tin","Tax identification number abroad"]],
  collections:[["pan","Collectee PAN"],["name","Collectee name"],["section","Collection code"],["paid_on","Date received or debited"],["amount","Amount received or debited"],["tds","Tax collected"],["status","Collectee code"],["rate","Rate"],["challan","Challan serial number"],["deducted_on","Date of collection"],["deposited","Tax deposited"],["remark","Reason code"],["certificate","Certificate number"],["non_resident","Non resident (Y or N)"],["establishment","Permanent establishment in India (Y or N)"],["opted_out","Opted out of section 202(1) (Y or N)"],["f_tds","Liable to TDS under section 394(5) (Y or N)"],["f_challan","TDS challan number"],["f_paid_on","TDS date of payment"]],
  challans:[["bsr","BSR code"],["date","Date of deposit"],["number","Challan serial number"],["tax","Tax"],["interest","Interest"],["fee","Fee"],["others","Penalty or others"],["minor","Minor head"]],
} as const;
export type TdsKind=keyof typeof tdsFields;
export const neededTds:Record<TdsKind,number>={payments:6,salaries:6,nonresident:8,collections:7,challans:4};
const amounts=new Set(["amount","tds","deposited","cash","tax","interest","fee","others"]),dates=new Set(["paid_on","deducted_on","date","f_paid_on"]);
export const tdsMappingSchema=z.object({kind:z.enum(["payments","salaries","nonresident","collections","challans"]),header:z.number().int().min(0).max(39),headings:z.array(z.string().max(200)).min(1).max(26),columns:z.array(z.number().int().min(-1).max(25)).max(24)});
export type TdsMapping=z.infer<typeof tdsMappingSchema>;
export const tdsMappingPlace=(client:string)=>`clients/${client}/tds_mapping`;
export const suggestTds=(kind:TdsKind,headings:string[])=>tdsFields[kind].map(([,name])=>headings.findIndex(heading=>heading.trim().toLowerCase()===name.toLowerCase()));

// A field of the statement's drafts: tds.p12.pan is the PAN on row 12 of a payment (salary,
// non resident or collection) register,
// tds.c3.bsr a challan's BSR code, tds.s.previous and tds.s.token the statement's own answers.
const fieldPattern=/^tds\.(?:([pc])(\d{1,5})\.([a-z0-9_]+)|s\.(previous|token))$/;
export const tdsField=(kind:"p"|"c",row:number,key:string)=>`tds.${kind}${row}.${key}`;

// A register's figures under the confirmed columns, a line a filled cell. Empty rows and total
// rows are left out. Amounts keep up to two decimals, dates become days.
export function extractTds(rows:string[][],asked:TdsMapping) {
  const mapping=tdsMappingSchema.parse(asked),fields=tdsFields[mapping.kind],used=mapping.columns.filter(column=>column>=0);
  if(!sameHeadings(rows[mapping.header] ?? [],mapping.headings) || mapping.columns.length!==fields.length) throw new Error("The columns changed. Check them again.");
  const heading=fields.slice(0,neededTds[mapping.kind]).map(([,name])=>name).join(", ");
  if(mapping.columns.slice(0,neededTds[mapping.kind]).some(column=>column<0)) throw new Error(`Choose a column for ${heading}.`);
  if(new Set(used).size!==used.length || used.some(column=>column>=mapping.headings.length)) throw new Error("Choose a different column for each field.");
  const lines:(Figure & {field:string;row:number;column:number})[]=[];
  for(let row=mapping.header+1;row<rows.length;row++) {
    if(!rows[row].some(cell=>cell.trim()) || rows[row].some(cell=>/^(grand\s+)?total$/i.test(cell.trim()))) continue;
    fields.forEach(([key,heading],index)=>{
      const column=mapping.columns[index],raw=column<0 ? "" : (rows[row][column] ?? "").trim();
      if(!raw) return;
      const label=`${heading}, row ${row+1}`;
      if(amounts.has(key) && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(\.\d{1,2})?$/.test(raw)) throw new Error(`Check ${heading} in row ${row+1}. Amounts need digits and up to two decimals.`);
      let value=raw;
      if(dates.has(key)) {try {value=date(raw);} catch {throw new Error(`Check ${heading} in row ${row+1}. Dates need a day, month and four digit year.`);}}
      else if(amounts.has(key)) value=raw.replaceAll(",","");
      // A spreadsheet keeps a code typed as a number with ".0" (1024.0, 200.0).
      else if(/^\d+\.0+$/.test(raw) && ["section","minor","challan","number","bsr","status","country","remittance","f_challan"].includes(key)) value=raw.replace(/\.0+$/,"");
      lines.push({field:tdsField(mapping.kind==="challans" ? "c" : "p",row+1,key),label,value:value.slice(0,2000),kind:dates.has(key) ? "date" : amounts.has(key) ? "number" : "text",row:row+1,column});
    });
  }
  if(!lines.length || lines.length>10000) throw new Error("Use a register with 1 to 10,000 filled cells.");
  return lines;
}

// The deductor's details the statement needs that a client does not hold yet (rows 44 to 115),
// kept encrypted on the client's TAN (client_registrations.details_enc).
const text=(max:number)=>z.string().trim().max(max);
const address={flat:text(25),post:text(25),road:text(25),area:text(25),district:text(25),state:z.string().regex(/^(\d{2})?$/),pin:z.string().regex(/^(\d{6})?$/),country:text(25),email:text(75),code:z.string().regex(/^(\d{1,5})?$/),phone:z.string().regex(/^(\d{1,10})?$/)};
export const deductorSchema=z.object({name:text(75),type:z.string().regex(/^[A-Z]?$/),...address,govt_state:z.string().regex(/^(\d{2})?$/),ministry:z.string().regex(/^(\d{2})?$/),ministry_other:text(150),
  person:z.object({name:text(75),designation:text(20),...address,pan:z.string().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/)})});
export type Deductor=z.infer<typeof deductorSchema>;
export const detailsPlace=(client:string,registration:string)=>`clients/${client}/tan/${registration}/details`;

// The quarter a statement is for, by its period key (the month the quarter ends, as the
// calendar's TDS_RET task keeps it): Q1 is April to June (row 61).
export function quarterOf(period:string) {
  const hit=/^(20\d{2})-(06|09|12|03)$/.exec(period);
  if(!hit) throw new Error("Choose the quarter.");
  const year=Number(hit[1]),month=Number(hit[2]),start=month===3 ? year-1 : year;
  const first=month===3 ? `${year}-01-01` : `${year}-${String(month-2).padStart(2,"0")}-01`,last=`${year}-${hit[2]}-${month===6 || month===9 ? "30" : "31"}`;
  return {quarter:`Q${month===3 ? 4 : month/3-1}`,first,last,taxYear:start};
}
// Forms No. 140, 138, 144 and 143 are for tax year 2026-27 onwards (row 2 of each): the June 2026
// quarter is their first.
export const statementPeriod=(period:string)=>/^20\d{2}-(06|09|12|03)$/.test(period) && period>="2026-06";

type Line={draft:string;line:string;field:string;value:string};
type Row={draft:string;row:number;lines:Map<string,string>;values:Map<string,string>};
export type Issue={text:string;line?:string};
export type Payment={draft:string;row:number;pan:string;name:string;section:string;paidOn:string;amount:bigint;tds:bigint;deposited:bigint;deductedOn:string;rate:string;challan:string;remark:string;certificate:string;form121:string;cash:bigint|null;line:string;lines:Map<string,string>;more:Record<string,string>};
export type Challan={draft:string;row:number;bsr:string;date:string;number:string;minor:string;tax:bigint;interest:bigint;fee:bigint;others:bigint;line:string;nil?:boolean;payments:Payment[];estimate?:bigint};
export type Statement={form?:TdsForm;tan:string;pan:string;deductor:Deductor;period:string;previous:string;token:string;today:string;challans:Challan[]};

const money=(paise:bigint)=>`${paise<BigInt(0) ? "-" : ""}${(paise<BigInt(0) ? -paise : paise)/BigInt(100)}.${String((paise<BigInt(0) ? -paise : paise)%BigInt(100)).padStart(2,"0")}`;
export const rupees=(paise:bigint)=>`₹${Number(money(paise)).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const ddmmyyyy=(day:string)=>`${day.slice(8,10)}${day.slice(5,7)}${day.slice(0,4)}`;
const digits=(value:string)=>value.replace(/\D/g,"");
// The rate with four decimals (general note 5): 2 is 2.0000.
const rate4=(value:string)=>{const [whole,part=""]=(value || "0").split(".");return `${Number(whole)}.${part.padEnd(4,"0")}`;};
const amountOf=(value:string|undefined)=>{if(!value) return BigInt(0);try {return hundredths(value);} catch {return BigInt(-1);}};

// The statement from its checked figures: every payment row, every challan (read from a register
// or entered by hand), and the statement's own answers. Payments are matched to their challan by
// its serial number; payments with no tax and no challan go under one nil challan (row 125).
export function readStatement(drafts:{id:string;lines:{id:string;field:string;value:string}[]}[]) {
  const rows=new Map<string,Row>(),answers=new Map<string,string>(),lines:Line[]=drafts.flatMap(draft=>draft.lines.map(line=>({draft:draft.id,line:line.id,field:line.field,value:line.value})));
  for(const line of lines) {
    const hit=fieldPattern.exec(line.field);
    if(!hit) continue;
    if(hit[4]) {answers.set(hit[4],line.value);continue;}
    const key=`${line.draft}|${hit[1]}${hit[2]}`;
    if(!rows.has(key)) rows.set(key,{draft:line.draft,row:Number(hit[2]),lines:new Map(),values:new Map()});
    rows.get(key)!.lines.set(hit[3],line.line);rows.get(key)!.values.set(hit[3],line.value);
  }
  const payments:Payment[]=[],challans:Challan[]=[];
  for(const [key,row] of rows) {
    const get=(name:string)=>(row.values.get(name) ?? "").trim(),first=[...row.lines.values()][0];
    if(key.split("|")[1].startsWith("p")) {
      const tds=amountOf(get("tds"));
      payments.push({draft:row.draft,row:row.row,pan:cleanNumber(get("pan")),name:get("name"),section:get("section"),paidOn:get("paid_on"),amount:amountOf(get("amount")),tds,deposited:row.values.has("deposited") ? amountOf(get("deposited")) : tds,
        deductedOn:get("deducted_on") || (tds>BigInt(0) ? get("paid_on") : ""),rate:get("rate"),challan:digits(get("challan")),remark:get("remark").toUpperCase(),certificate:cleanNumber(get("certificate")),form121:get("form121"),cash:row.values.has("cash") ? amountOf(get("cash")) : null,line:first,lines:row.lines,
        more:Object.fromEntries([...row.values.keys()].map(name=>[name,get(name)]))});
    } else challans.push({draft:row.draft,row:row.row,bsr:get("bsr"),date:get("date"),number:get("number"),minor:get("minor"),tax:amountOf(get("tax")),interest:amountOf(get("interest")),fee:amountOf(get("fee")),others:amountOf(get("others")),line:first,payments:[]});
  }
  const order=(a:{draft:string;row:number},b:{draft:string;row:number})=>a.draft.localeCompare(b.draft) || a.row-b.row;
  payments.sort(order);challans.sort(order);
  return {payments,challans,previous:(answers.get("previous") ?? "").toUpperCase(),token:answers.get("token") ?? ""};
}

// Each check is a rule of the format, said in words a CA reads. Errors stop the statement;
// warnings are rows a person looks at one by one before the rest are checked at once.
const special=/^[\s`~!@#$%^&*()_+,./?;:'"’”[{\]}\\|-]*$/;
const email=(value:string)=>/^[^\s^@]+@[^\s^@.]+(\.[^\s^@.]+)*\.[^\s^@.]+$/.test(value) && /^[\x21-\x7e]+$/.test(value);
// What differs by form. Tax paid before release shows no tax: Form No. 144 rows 161, 177, 178 and
// 181 (codes 1059 and 1061). General note 10 of each form: the reasons a row under a nil challan
// may give (Forms No. 138 and 144 also name B, which their Annexure 6 gives no code). Form No. 138
// rows 176 and 177 and Form No. 143 rows 177 and 178: the tax deposited equals the tax deducted
// or collected. Form No. 138 has no rate (row 180).
const paidBeforeOf:Record<TdsForm,Set<string>>={TDS140:paidBefore,TDS138:new Set(),TDS144:new Set(["1059","1061"]),TDS143:new Set()};
const nilOf:Record<TdsForm,Set<string>>={TDS140:nilReasons,TDS138:new Set(["A"]),TDS144:new Set(["A","G","H","I","N","Y","Z"]),TDS143:new Set(["A","B","F","K","Y","Z"])};
const codesOf:Record<TdsForm,Record<string,string>>={TDS140:sectionCodes,TDS138:salarySections,TDS144:nonResidentSections,TDS143:collectionCodes};
const equal=new Set<TdsForm>(["TDS138","TDS143"]);
// Form No. 144 rows 190 to 194: the natures of remittance for which a deductee with no PAN, at a
// rate below 20% and reason C, gives an address abroad, email, phone and tax number.
const detailed=new Set(["16","27","49","21","52","31"]);
const two=(code:string)=>code ? String(Number(code)).padStart(2,"0") : "";
const yesNo=(value:string)=>["","Y","N"].includes(value);
export function checkStatement(input:{form?:TdsForm;tan:string;pan:string;deductor:Deductor|null;period:string;previous:string;token:string;today:string;payments:Payment[];challans:Challan[]}) {
  const errors:Issue[]=[],warnings:Issue[]=[],add=(list:Issue[],text:string,line?:string)=>list.push({text,...(line && {line})});
  const form=input.form ?? "TDS140",f=tdsForms[form],who=f.who,named=tdsName(form);
  if(!statementPeriod(input.period)) {add(errors,`${named} is for tax year 2026-27 onwards. Prepare earlier quarters as Form ${f.was} in your filing software.`);return {errors,warnings,challans:[] as Challan[]};}
  if(waitsForFormat(form,input.period)) {add(errors,"Form No. 138 for January to March waits for Protean's file format for the fourth quarter, which is not published yet. InboxCA prepares it once Protean publishes it.");return {errors,warnings,challans:[] as Challan[]};}
  const {first,last,taxYear}=quarterOf(input.period),d=input.deductor;
  // The deductor (rows 44 to 115).
  if(!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(input.tan)) add(errors,"The TAN must be 4 letters, 5 digits and a letter, in capitals.");
  if(!d) add(errors,"Fill the TDS statement details on the client's Details first.");
  else {
    const need=(value:string,what:string)=>{if(!value.trim() || special.test(value)) add(errors,`${what} is missing.`);};
    need(d.name,`The ${who}'s name as on the TAN`);
    if(!deductorTypes[d.type]) add(errors,`Choose the type of ${who}.`);
    need(d.flat,`The ${who}'s flat, door or block number`);need(d.country,`The ${who}'s country`);
    if(!stateCodes[d.state]) add(errors,`Choose the ${who}'s state.`);
    if(!/^\d{6}$/.test(d.pin)) add(errors,`The ${who}'s PIN code needs 6 digits.`);
    // Rows 71 and 85: one of the two email addresses is needed, and each given must be valid.
    if(!d.email && !d.person.email) add(errors,`Give the ${who}'s email or the responsible person's email.`);
    for(const [value,whose] of [[d.email,`${who}'s`],[d.person.email,"responsible person's"]]) if(value && !email(value)) add(errors,`The ${whose} email is not a valid address.`);
    if(!d.code || !d.phone) add(errors,`The ${who}'s phone number and country calling code are missing.`);
    need(d.person.name,`The name of the person responsible for ${f.tax==="collected" ? "collection" : "deduction"}`);need(d.person.designation,"The responsible person's designation");
    need(d.person.flat,"The responsible person's flat, door or block number");need(d.person.country,"The responsible person's country");
    if(!stateCodes[d.person.state]) add(errors,"Choose the responsible person's state.");
    if(!/^\d{6}$/.test(d.person.pin)) add(errors,"The responsible person's PIN code needs 6 digits.");
    if(!d.person.code || !d.person.phone) add(errors,"The responsible person's phone number and country calling code are missing.");
    if(!isPan(d.person.pan)) add(errors,"The responsible person's PAN is missing or not a valid PAN.");
    // Row 97: a State Government's state; row 100: a Central Government's ministry.
    if(["S","E","H","N"].includes(d.type) !== !!stateCodes[d.govt_state]) add(errors,["S","E","H","N"].includes(d.type) ? `Choose the state of this State Government ${who}.` : `Leave the government state empty for this type of ${who}.`);
    if(["A","D","G"].includes(d.type) ? !ministryCodes[d.ministry] : d.ministry && !["E","H","L","N"].includes(d.type)) add(errors,["A","D","G"].includes(d.type) ? `Choose the ministry of this Central Government ${who}.` : `Leave the ministry empty for this type of ${who}.`);
    if(d.ministry==="99" && !d.ministry_other.trim()) add(errors,"Name the ministry, as Others is chosen.");
    // Row 58: a deductor not required to have a PAN writes PANNOTREQD.
    if(!isPan(input.pan) && !(input.pan==="PANNOTREQD" && government.has(d.type))) add(errors,`Add the client's PAN under Tax numbers. Only a government ${who} may file without one.`);
  }
  // Rows 52 and 95: whether a regular statement of the form was filed for an earlier quarter, and its token.
  if(!["Y","N"].includes(input.previous)) add(errors,`Say whether a regular ${named} was filed for an earlier quarter.`);
  if(input.previous==="Y" && !/^\d{15}$/.test(input.token)) add(errors,`Give the 15 digit token number of the last regular ${named} filed.`);
  // Challans (rows 120 to 149).
  const challanKey=(number:string)=>String(Number(digits(number) || "0"));
  const byNumber=new Map<string,Challan[]>();
  const challans=input.challans.map(challan=>({...challan,payments:[] as Payment[]}));
  for(const challan of challans) {
    const at=challan.line,name=`Challan ${challan.number || `row ${challan.row}`}`;
    if(!/^\d{1,7}$/.test(digits(challan.bsr)) || digits(challan.bsr)!==challan.bsr.replace(/\s/g,"")) add(errors,`${name}: the BSR code needs up to 7 digits.`,at);
    if(!/^\d{1,5}$/.test(challan.number.replace(/\s/g,""))) add(errors,`${name}: the challan serial number needs up to 5 digits.`,at);
    // Row 138: on or after 1 April of the previous financial year, and never a future day (note 8).
    if(!/^\d{4}-\d{2}-\d{2}$/.test(challan.date)) add(errors,`${name}: the date of deposit is missing.`,at);
    else if(challan.date<`${taxYear-1}-04-01` || challan.date>input.today) add(errors,`${name}: the date of deposit must be on or after 1 April ${taxYear-1} and not later than today.`,at);
    // FVU T-FV-3159: every challan names its minor head.
    if(!minorHeads[challan.minor]) add(errors,`${name}: the minor head must be 200, 400 or 100.`,at);
    if(challan.minor==="100" && challan.date && (challan.date<first || challan.date>last)) add(errors,`${name}: with minor head 100 the date of deposit must be within the quarter.`,at);
    // Rows 127 to 131: whole rupees, as 1000.00.
    for(const [value,what] of [[challan.tax,"tax"],[challan.interest,"interest"],[challan.fee,"fee"],[challan.others,"penalty or others"]] as const)
      if(value<BigInt(0) || value%BigInt(100)!==BigInt(0)) add(errors,`${name}: the ${what} must be in whole rupees, not below zero.`,at);
    if(challan.tax+challan.interest+challan.fee+challan.others<=BigInt(0)) add(errors,`${name}: the challan has no amount.`,at);
    const key=challanKey(challan.number);
    byNumber.set(key,[...(byNumber.get(key) ?? []),challan]);
  }
  for(const [number,list] of byNumber) if(list.length>1) add(errors,`Two challans have serial number ${number}. Keep each challan once, so each payment matches one challan.`,list[1].line);
  // Payments (rows 154 to 198).
  const nil:Challan={draft:"",row:0,bsr:"",date:last,number:"",minor:"",tax:BigInt(0),interest:BigInt(0),fee:BigInt(0),others:BigInt(0),line:"",nil:true,payments:[]};
  const taken=f.tax==="collected" ? "collection" : "deduction",codes=codesOf[form],paidBeforeHere=paidBeforeOf[form];
  if(!input.payments.length) add(errors,`Add at least one ${f.tax==="collected" ? "collection" : "payment"}. A statement with no ${f.payee} rows cannot be validated (general note ${form==="TDS140" ? 15 : 14}).`);
  for(const pay of input.payments) {
    const at=pay.line,name=`Row ${pay.row}`,line=(key:string)=>pay.lines.get(key) ?? at,zero=BigInt(0);
    const valid=isPan(pay.pan),known=noPans.includes(pay.pan);
    const flag=(key:string)=>(pay.more[key] ?? "").toUpperCase(),given=(key:string)=>pay.more[key] ?? "";
    if(!pay.pan) add(warnings,`${name}: no PAN. InboxCA writes PANNOTAVBL, as the format asks when the ${f.payee} gave no PAN. Tax should be at the higher rate of section 397(2)(b), with reason code C.`,at);
    else if(known) add(warnings,`${name}: the PAN is given as ${pay.pan}. Check the ${f.payee}'s declaration.`,line("pan"));
    else if(!valid) add(errors,`${name}: the PAN is not a valid PAN. Write it as 5 letters, 4 digits and a letter, or as PANAPPLIED, PANINVALID or PANNOTAVBL.`,line("pan"));
    if(!pay.name || special.test(pay.name)) add(errors,`${name}: the ${f.payee}'s name is missing.`,at);
    else if(pay.name.length>75) add(errors,`${name}: the ${f.payee}'s name is longer than 75 letters.`,line("name"));
    if(!codes[pay.section]) {add(errors,`${name}: the ${form==="TDS143" ? "collection" : "section"} code must be one of the official four digit codes of ${named}, such as ${f.example}.`,line("section"));continue;}
    if(paidBeforeHere.has(pay.section) && !valid) add(errors,`${name}: code ${pay.section} needs the ${f.payee}'s real PAN.`,line("pan"));
    // Section 397(2)(b): no valid PAN, so at least the higher rate; section 393(1): the Act's rate.
    // A reason code is a lower deduction the CA chose, so only the PAN rule then applies.
    const least=paidBeforeHere.has(pay.section) ? 0 : valid ? (form==="TDS140" && !pay.remark ? actRates[pay.section] ?? 0 : 0) : pay.remark && pay.tds===zero ? 0 : noPanRate(form,pay.section);
    const due=pay.amount*BigInt(least)/BigInt(10000);
    if(least && pay.amount>zero && pay.tds>=zero && due-pay.tds>BigInt(100)) add(warnings,valid ? `${name}: tax ${f.tax} ${rupees(pay.tds)} is less than ${rupees(due)}, the ${least/100}% section ${sectionCodes[pay.section]} sets for code ${pay.section}, short by ${rupees(due-pay.tds)}. Check the rate, or give the reason code for a lower ${taken}.`
      : `${name}: with no valid PAN, section 397(2)(b) asks for at least ${least/100}%, ${rupees(due)} on ${rupees(pay.amount)}. The tax ${f.tax} is ${rupees(pay.tds)}, short by ${rupees(due-pay.tds)}.`,line("tds"));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(pay.paidOn) || pay.paidOn<first || pay.paidOn>last) add(errors,`${name}: the date of payment or credit must be within the quarter.`,line("paid_on"));
    else if(pay.paidOn>input.today) add(errors,`${name}: the date of payment or credit is later than today.`,line("paid_on"));
    if(pay.amount<=zero) add(errors,`${name}: the amount paid must be more than 0.`,line("amount"));
    if(pay.tds<zero || pay.deposited<zero) add(errors,`${name}: the tax ${f.tax} and deposited cannot be below zero.`,line("tds"));
    if(paidBeforeHere.has(pay.section) && (pay.tds!==zero || pay.deposited!==zero || Number(pay.rate || 0)!==0)) add(errors,`${name}: for code ${pay.section} the tax deducted, deposited and rate must be 0 (the tax was paid before release).`,line("tds"));
    if(pay.deposited>pay.tds) add(errors,`${name}: the tax deposited is more than the tax ${f.tax}.`,line("deposited"));
    else if(pay.deposited<pay.tds && equal.has(form)) add(errors,`${name}: the tax deposited must equal the tax ${f.tax}, as ${named} asks.`,line("deposited"));
    else if(pay.deposited<pay.tds) add(warnings,`${name}: less tax deposited than deducted. The statement says it was not all deposited.`,line("deposited"));
    // Rows 180 and 181: the deduction date and the rate.
    if(pay.tds>zero && (!/^\d{4}-\d{2}-\d{2}$/.test(pay.deductedOn) || pay.deductedOn<first || pay.deductedOn>input.today)) add(errors,`${name}: the date of ${taken} must be on or after ${first.split("-").reverse().join("-")} and not later than today.`,line("deducted_on"));
    if(form==="TDS138") {/* Form No. 138 takes no rate. */}
    else if(pay.rate && !/^\d{1,2}(\.\d{1,4})?$/.test(pay.rate)) add(errors,`${name}: the rate needs digits with up to four decimals, such as 10 or 0.1.`,line("rate"));
    else if(pay.tds>zero && !pay.rate) add(errors,`${name}: the rate is missing.`,at);
    else if(pay.tds===zero && Number(pay.rate || 0)!==0) add(errors,`${name}: no tax was deducted, so the rate must be 0, as the format asks.`,line("rate"));
    // Rows 185 and 186, Annexure 6: the reason code, and a certificate for code A.
    if(pay.remark && !reasons[form][pay.remark]?.split(" ").includes(pay.section)) add(errors,`${name}: reason code ${pay.remark} does not go with section code ${pay.section}.`,line("remark"));
    if(pay.remark==="A" && !/^[A-Z0-9]{10}$|^[A-Z0-9]{15}$/.test(pay.certificate)) add(errors,`${name}: reason code A needs the certificate number, 10 or 15 letters and digits.`,line("certificate"));
    if(pay.remark==="T" && !valid) add(errors,`${name}: reason code T (transporter) needs the deductee's PAN.`,line("pan"));
    if(pay.form121 && pay.form121.length!==26) add(errors,`${name}: the Form No. 121 number must be 26 characters.`,line("form121"));
    // Rows 175 and 176: the cash withdrawn above the limit, only for codes 1065 and 1064.
    if(["1064","1065"].includes(pay.section) ? pay.cash===null || pay.cash<=zero : pay.cash!==null) add(errors,["1064","1065"].includes(pay.section) ? `${name}: code ${pay.section} needs the cash withdrawn above the limit.` : `${name}: the cash withdrawn above the limit is only for codes 1064 and 1065.`,line("cash"));
    // Form No. 138 Annexure 6: A needs the employee's PAN; C only a PAN not given, with at least 20%.
    if(form==="TDS138" && pay.remark==="A" && !valid) add(errors,`${name}: reason code A needs the employee's PAN.`,line("pan"));
    if(form==="TDS138" && pay.remark==="C" && (valid || pay.tds*BigInt(5)<pay.amount)) add(errors,`${name}: reason code C is only for an employee with no valid PAN, with tax of at least 20% of the amount paid.`,line("remark"));
    // Forms No. 144 (row 165) and 143 (row 165): the status or collectee code of Annexure 8.
    if((form==="TDS144" || form==="TDS143") && !statusCodes[given("status") ? String(Number(given("status"))) : ""]) add(errors,`${name}: the ${form==="TDS143" ? "collectee" : "status"} code must be 1 to 10, such as 1 for a company or 2 for an individual.`,line("status"));
    if(form==="TDS144") {
      // Rows 167 to 183: the country, the nature of remittance of Annexure 9, the answers.
      if(!countryCodes.includes(two(given("country")))) add(errors,`${name}: the country code must be one of the official codes, such as 265 for the United Kingdom or 267 for the United States.`,line("country"));
      const allowed=remittances[pay.section]?.split(" "),nature=two(given("remittance"));
      if(allowed ? !allowed.includes(nature) : nature) add(errors,allowed ? `${name}: code ${pay.section} needs the nature of remittance code, one of ${allowed.join(", ")}.` : `${name}: code ${pay.section} takes no nature of remittance code. Leave it empty.`,line("remittance"));
      if(!yesNo(flag("grossed")) || !yesNo(flag("opted_out"))) add(errors,`${name}: grossed up and opted out of section 202(1) are Y or N.`,line(yesNo(flag("grossed")) ? "opted_out" : "grossed"));
      if(!["A","B"].includes(flag("dtaa"))) add(errors,`${name}: say whether the rate is under the Act (A) or a DTAA (B).`,line("dtaa"));
      if(given("email") && !email(given("email"))) add(errors,`${name}: the deductee's email is not a valid address.`,line("email"));
      if(given("phone") && !/^\d{1,15}$/.test(digits(given("phone")))) add(errors,`${name}: the deductee's phone needs up to 15 digits.`,line("phone"));
      if(given("address").length>150 || given("tin").length>25 || (given("tin") && /^[0\W_]*$/.test(given("tin")))) add(errors,`${name}: the address abroad takes up to 150 letters and the tax identification number up to 25, not only zeros.`,line(given("address").length>150 ? "address" : "tin"));
      const missing=["address","email","phone","tin"].some(key=>!given(key));
      if(!valid && missing && Number(pay.rate || 0)<20 && pay.remark==="C" && detailed.has(nature)) add(errors,`${name}: with no PAN, a rate below 20%, reason C and this nature of remittance, the format needs the deductee's address abroad, email, phone and tax identification number.`,line("address"));
      else if(!valid && missing) add(warnings,`${name}: no PAN. Give the deductee's address abroad, email, phone and tax identification number where the format asks for them.`,line("address"));
    }
    if(form==="TDS143") {
      // Rows 164 to 167 and 187 to 189: non resident, permanent establishment, the answers of reason F.
      const away=flag("non_resident"),place=flag("establishment"),liable=flag("f_tds"),reasonF=pay.remark==="F" && ["1086","1087","1088","1089"].includes(pay.section);
      if(!yesNo(away) || !yesNo(flag("opted_out"))) add(errors,`${name}: non resident and opted out of section 202(1) are Y or N.`,line(yesNo(away) ? "opted_out" : "non_resident"));
      if(away==="Y" ? !["Y","N"].includes(place) : place) add(errors,away==="Y" ? `${name}: say whether this non resident collectee has a permanent establishment in India (Y or N).` : `${name}: the permanent establishment answer is only for a non resident collectee.`,line("establishment"));
      if(!reasonF && (liable || given("f_challan") || given("f_paid_on"))) add(errors,`${name}: the TDS answers under section 394(5) are only for reason code F with codes 1086 to 1089.`,line("f_tds"));
      else if(!yesNo(liable)) add(errors,`${name}: liable to TDS under section 394(5) is Y or N.`,line("f_tds"));
      else if(liable==="Y" && (!/^\d{1,5}$/.test(digits(given("f_challan"))) || !/^\d{4}-\d{2}-\d{2}$/.test(given("f_paid_on")))) add(errors,`${name}: with Y, give the TDS challan number (up to 5 digits) and its date of payment.`,line("f_challan"));
    }
    if(!pay.challan && pay.tds===zero) {
      // FVU T_FV_6535 (Form No. 140) and T_FV_6537 (Form No. 144): a challan with a row of these
      // codes is paid by challan (mode C), and a nil challan has no mode (T-FV-3164).
      if(paidBeforeHere.has(pay.section)) {add(errors,`${name}: for code ${pay.section} give the serial number of the challan the tax was paid with before release.`,line("challan"));continue;}
      if(!nilOf[form].has(pay.remark)) add(errors,`${name}: no tax was ${f.tax} and no challan is given. Give the reason code for no ${taken}, such as ${form==="TDS138" ? "A for a certificate under section 395(1)" : "Y for below the threshold"}.`,line("remark"));
      nil.payments.push(pay);continue;
    }
    const challan=byNumber.get(challanKey(pay.challan))?.[0];
    if(!pay.challan) add(errors,`${name}: tax was ${f.tax}, so give the serial number of the challan it was paid with. Until then no challan covers it.`,at);
    else if(!challan) add(errors,`${name}: no challan with serial number ${pay.challan} is in this statement, so no challan covers this tax. Add the challan or correct the serial number.`,line("challan"));
    else challan.payments.push(pay);
  }
  // Rows 131 and 138: a challan covers the tax deposited of its payments, and is paid on or
  // before their payment dates when its minor head is 100.
  for(const challan of challans) {
    const deposited=challan.payments.reduce((sum,pay)=>sum+pay.deposited,BigInt(0)),name=`Challan ${challan.number}`;
    if(!challan.payments.length) add(warnings,`${name}: no payment in this statement is linked to it.`,challan.line);
    else if(deposited>challan.tax) add(errors,`${name}: does not cover its rows. They show ${rupees(deposited)} of tax deposited, more than its tax of ${rupees(challan.tax)}, short by ${rupees(deposited-challan.tax)}. Correct the challan or link some rows to another challan.`,challan.line);
    else if(deposited<challan.tax) add(warnings,`${name}: ${rupees(challan.tax-deposited)} of its tax is not linked to any payment in this statement.`,challan.line);
    if(challan.minor==="100" && challan.payments.some(pay=>pay.paidOn<challan.date)) add(errors,`${name}: with minor head 100 the challan must be paid on or before each payment's date.`,challan.line);
    // Section 398(3)(a)(ii) on each row's tax paid after its Rule 218(2) date; an office of the
    // Government (Rule 218(1)) is left out.
    if(!d || ["A","S"].includes(d.type) || !/^\d{4}-\d{2}-\d{2}$/.test(challan.date)) continue;
    const late=challan.payments.filter(pay=>pay.deposited>BigInt(0) && /^\d{4}-\d{2}-\d{2}$/.test(pay.deductedOn) && challan.date>payBy(pay.deductedOn));
    challan.estimate=late.reduce((sum,pay)=>sum+pay.deposited*BigInt(15*lateMonths(pay.deductedOn,challan.date))/BigInt(1000),BigInt(0));
    if(late.length) add(warnings,`${name}: tax of ${late.length===1 ? "1 row was" : `${late.length} rows were`} paid after the date of Rule 218(2). Interest estimate: ${rupees(challan.estimate)} (section 398(3)(a)(ii)), check before filing. The challan shows ${rupees(challan.interest)} of interest.`,challan.line);
  }
  // Section 427: the fee for a statement delivered after its Rule 219(4) date, if delivered today.
  const filingDue=statementDue(input.period),days=Math.round((Date.parse(input.today)-Date.parse(filingDue))/86400000);
  if(days>0) {
    const most=input.payments.reduce((sum,pay)=>sum+(pay.tds>BigInt(0) ? pay.tds : BigInt(0)),BigInt(0)),fee=BigInt(20000*days)<most ? BigInt(20000*days) : most;
    add(warnings,`${named} was due on ${filingDue.split("-").reverse().join("-")}. Fee estimate: ${rupees(fee)} (section 427), ₹200 for each of ${days} days to today, at most the tax ${f.tax}, check before filing. The challans show ${rupees(challans.reduce((sum,c)=>sum+c.fee,BigInt(0)))} of fee.`);
  }
  return {errors,warnings,challans:[...challans,...(nil.payments.length ? [nil] : [])]};
}

// The statement file (general notes 1, 2, 9, 10): ASCII, one record a line, each ending in CR LF,
// fields joined by ^ with one fewer ^ than fields. The file header, one batch header, then each
// challan followed by its payments. Line numbers run through the file. Every form has the same
// four records; its file type, form number and the deductee fields it takes differ.
const flagOf=(pay:Payment,key:string)=>(pay.more[key] ?? "").toUpperCase();
const cashOf=(pay:Payment)=>({22:pay.section==="1065" && pay.cash!==null ? money(pay.cash) : "",23:pay.section==="1064" && pay.cash!==null ? money(pay.cash) : ""});
const rateOf=(pay:Payment)=>pay.tds>BigInt(0) ? rate4(pay.rate) : "0.0000";
// The deductee or collectee fields each form takes besides the common ones: Form No. 140 rows 175
// to 184; Form No. 138 row 181 (the date of deposit, the challan's, written as a date as its
// remarks ask though the row says DECIMAL 7); Form No. 144 rows 165 to 194 (Y or N answers left
// empty are No); Form No. 143 rows 164 to 189 (FVU T_FV_6460: the TDS challan number in five
// digits, as the challan's own serial number).
const deducteeFields:Record<TdsForm,(pay:Payment,challan:Challan)=>Record<number,string>>={
  TDS140:pay=>({...cashOf(pay),28:rateOf(pay),31:pay.form121}),
  TDS138:(pay,challan)=>({29:pay.deposited>BigInt(0) && !challan.nil ? ddmmyyyy(challan.date) : ""}),
  TDS144:pay=>({12:String(Number(pay.more.status)),14:flagOf(pay,"opted_out") || "N",16:two(pay.more.remittance ?? ""),17:two(pay.more.country ?? ""),21:flagOf(pay,"grossed") || "N",...cashOf(pay),28:rateOf(pay),30:flagOf(pay,"dtaa"),31:pay.form121,
    37:pay.more.address ?? "",38:pay.more.email ?? "",39:digits(pay.more.phone ?? ""),41:pay.more.tin ?? ""}),
  TDS143:pay=>{const away=flagOf(pay,"non_resident") || "N",liable=flagOf(pay,"f_tds");
    return {11:away,12:String(Number(pay.more.status)),13:away==="Y" ? flagOf(pay,"establishment") : "",14:flagOf(pay,"opted_out") || "N",28:rateOf(pay),34:liable,35:liable==="Y" ? digits(pay.more.f_challan ?? "").padStart(5,"0") : "",36:liable==="Y" ? ddmmyyyy(pay.more.f_paid_on ?? "") : ""};},
};
export function statementFile(statement:Statement) {
  const form=statement.form ?? "TDS140",{quarter,taxYear}=quarterOf(statement.period),d=statement.deductor,lines:string[][]=[];
  const record=(fields:number,values:Record<number,string>)=>{const out=Array.from({length:fields},(_,at)=>values[at+1] ?? "");out[0]=String(lines.length+1);lines.push(out);};
  const challans=statement.challans,total=challans.reduce((sum,c)=>sum+c.tax+c.interest+c.fee+c.others,BigInt(0));
  // File header, 18 fields (rows 22 to 39).
  record(18,{2:"FH",3:tdsForms[form].fileType,4:"R",5:ddmmyyyy(statement.today),6:"1",7:"D",8:statement.tan,9:"1",10:"InboxCA"});
  // Batch header, 72 fields (rows 44 to 115). Assessment year 202728 and tax year 202627 for
  // tax year 2026-27 (rows 59 and 60). FVU T-FV-2127: Form No. 138 for the first three quarters
  // counts 0 salary detail records.
  const p=d.person;
  record(72,{2:"BH",3:"1",4:String(challans.length),5:tdsForms[form].number,9:statement.previous==="Y" ? statement.token : "",13:statement.tan,15:statement.pan,16:`${taxYear+1}${String(taxYear+2).slice(2)}`,17:`${taxYear}${String(taxYear+1).slice(2)}`,18:quarter,
    19:d.name,20:d.country,21:d.flat,22:d.post,23:d.road,24:d.area,25:d.district,26:d.state,27:d.pin,28:d.email,29:d.code,30:d.phone,32:d.type,
    33:p.name,34:p.designation,35:p.flat,36:p.post,37:p.road,38:p.area,39:p.district,40:p.state,41:p.pin,42:p.email,43:p.country,44:p.code,45:p.phone,
    47:money(total),49:form==="TDS138" ? "0" : "",52:statement.previous,54:d.govt_state,57:d.ministry,58:d.ministry==="99" ? d.ministry_other : "",59:p.pan});
  challans.forEach((challan,at)=>{
    const deducted=challan.payments.reduce((sum,pay)=>sum+pay.tds,BigInt(0)),deposited=challan.payments.reduce((sum,pay)=>sum+pay.deposited,BigInt(0));
    // Challan detail, 30 fields (rows 120 to 149). A nil challan has no mode, BSR code or serial
    // number, and is dated the quarter's last day (rows 125, 132, 134, 136, 138).
    record(30,{2:"CD",3:"1",4:String(at+1),5:String(challan.payments.length),6:challan.nil ? "Y" : "N",8:money(challan.tax),9:money(challan.interest),10:money(challan.fee),11:money(challan.others),
      12:money(challan.tax+challan.interest+challan.fee+challan.others),13:challan.nil ? "" : "C",15:challan.nil ? "" : digits(challan.bsr).padStart(7,"0"),17:challan.nil ? "" : digits(challan.number).padStart(5,"0"),19:ddmmyyyy(challan.date),
      21:money(deposited),22:money(deducted),23:challan.minor,24:money(challan.interest),25:money(challan.others)});
    // Deductee detail, 45 fields (rows 154 to 198), numbered from 1 under each challan.
    challan.payments.forEach((pay,n)=>record(45,{2:"DD",3:"1",4:String(n+1),5:String(at+1),6:"O",8:pay.pan || "PANNOTAVBL",9:pay.name,15:pay.section,18:pay.deposited===pay.tds ? "Y" : "N",19:ddmmyyyy(pay.paidOn),20:money(pay.amount),
      24:money(pay.tds),25:money(pay.deposited),27:pay.tds>BigInt(0) ? ddmmyyyy(pay.deductedOn) : "",32:pay.remark,33:pay.certificate,...deducteeFields[form](pay,challan)}));
  });
  const body=lines.map(fields=>fields.join("^")).join("\r\n")+"\r\n";
  // Only printable ASCII, and never a ^ or a line break inside a field.
  if(lines.some(fields=>fields.some(value=>/[\^\r\n]/.test(value))) || !/^[\x20-\x7e\r\n]*$/.test(body)) throw new Error("A name or address has a character the statement cannot hold. Use English letters, digits and common punctuation, and no ^.");
  return body;
}

