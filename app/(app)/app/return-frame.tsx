import "./return-frame.css";
import Link from "next/link";
import {ViewTransition} from "react";
import {Check,ChevronLeft} from "lucide-react";
import {Badge,PageHead} from "./ui";

export type FrameStep={key:string;label:string;href:string;state:"done"|"now"|"later"};

// A return's own page (clients/[id]/returns/[task]): its name and period, when it is due (red
// only when late), who looks after it and where it stands in words; then its steps as links, done
// ones open again; the next step with its one button, or why it waits; and the step shown, which
// slides in when the step changes. Props only.
export function ReturnFrame({back,title,due,late,people,status,steps,shown,next,children}:{back:{href:string;name:string};title:string;due:string;late:boolean;people:React.ReactNode;status:string;steps:FrameStep[];shown:string;next:{step:string;why?:string;action?:React.ReactNode}|null;children:React.ReactNode}) {
  const at=Math.max(0,steps.findIndex(step=>step.state!=="done")),filed=steps.every(step=>step.state==="done");
  return <>
    <PageHead crumb={<Link className="crumb" href={back.href}><ChevronLeft size={14} aria-hidden/>{back.name}</Link>} title={title}
      sub={<span className="head-meta rs-head">
        <Badge tone={late ? "late" : filed ? "done" : "blue"}>{due}</Badge>
        <span className="rs-people">{people}</span>
        <span className="rs-status">{status}</span>
      </span>}/>
    <div className="pane rs">
      <nav aria-label="Steps of this return">
        <ol className={`rs-steps${filed ? " is-filed" : ""}`} style={{"--n":steps.length,"--at":filed ? 1 : at/Math.max(1,steps.length-1)} as React.CSSProperties}>
          {steps.map((step,n)=><li key={step.key} className={`is-${step.state}${step.key===shown ? " is-shown" : ""}`}>
            <Link href={step.href} scroll={false} aria-current={step.key===shown ? "step" : undefined}>
              <span className="rs-dot" aria-hidden>{step.state==="done" ? <Check size={13} strokeWidth={3}/> : n+1}</span>
              <span className="rs-name">{step.label}<small>{step.state==="done" ? "Done" : step.state==="now" ? "Now" : "Waits"}</small></span>
            </Link>
          </li>)}
        </ol>
      </nav>
      <section className={`rs-next${next ? "" : " is-filed"}`} aria-label="Next step">
        <p className="grow"><strong>{next ? `Next step: ${next.step}` : "Filed"}</strong>{next ? next.why && <span>{next.why}</span> : <span>Nothing left to do on this return.</span>}</p>
        {next?.action}
      </section>
      <ViewTransition key={shown} enter="step-in" exit="step-out" default="none">
        <div className="rs-body">{children}</div>
      </ViewTransition>
    </div>
  </>;
}
