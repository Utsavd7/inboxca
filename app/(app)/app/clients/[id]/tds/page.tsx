import {TdsStatement} from "./tds-statement";

// One TDS or TCS statement for one TAN and quarter (tds-statement.tsx).
export default async function TdsPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const [{id},q]=await Promise.all([params,searchParams]);
  return <TdsStatement id={id} q={q}/>;
}
