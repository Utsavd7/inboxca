import {Fragment,type ReactNode} from "react";
import type {FormLayout,FormRow} from "@/src/lib/form-layout";

// A return drawn as its official form lays it out (src/lib/form-layout.ts): each table under its
// number and name, rows in the form's order, a greyed box where the form has none. cell draws a
// box's figures (Check on the form); a box with words (a prepared return, a row left for the
// portal) shows them. open adds a line under a row, for the chosen figure's Yes and No.
export function FigureForm({layout,cell,open}:{layout:FormLayout;cell?:(id:string,many:boolean)=>ReactNode;open?:(row:FormRow)=>ReactNode}) {
  return <div className="fs">{layout.tables.map((table)=>{
    const span=Math.max(1,table.heads.length);
    return <section key={table.key} className="fs-table" aria-labelledby={table.name ? `fs-${table.key}` : undefined}>
      {table.name && <h3 id={`fs-${table.key}`}>{table.number && <span className="fs-num">{table.number}</span>}{table.name}</h3>}
      <div className="table-wrap"><table className="t fs-grid">
        <thead><tr><th scope="col">Details</th>{table.heads.length ? table.heads.map((head)=><th key={head} scope="col" className="is-num">{head}</th>) : <th scope="col"><span className="sr-only">Value</span></th>}</tr></thead>
        <tbody>{table.rows.map((row)=>{
          if(row.fill==="heading") return <tr key={row.key} className="fs-heading"><th colSpan={span+1} scope="rowgroup">{row.number && <span className="fs-rnum">{row.number}</span>}{row.name}</th></tr>;
          const merged=row.fill!=="figures" && row.fill!=="worked" || row.cells.length===1 && span>1;
          const extra=open?.(row);
          return <Fragment key={row.key}>
            <tr className={`fs-row is-${row.fill}`}>
              <th scope="row">{row.number && <span className="fs-rnum">{row.number}</span>}{row.name}</th>
              {merged ? <td colSpan={span} className="fs-words">{row.cells[0]?.text}</td> : row.cells.map((one,index)=><td key={index} className={`fs-cell${one ? "" : " is-off"}`}>
                {one?.ids ? one.ids.map((id)=>cell?.(id,one.ids!.length>1)) : one?.text ? <span className="fs-text">{one.text}</span> : <span className="sr-only">Not in these figures</span>}
              </td>)}
            </tr>
            {extra && <tr className="fs-open"><td colSpan={span+1}>{extra}</td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>
    </section>;
  })}</div>;
}
