"use client";
import "./return-work.css";
import {useActionState} from "react";
import {fillNow,type FillState} from "./form-actions";
import {Pending} from "./pending";

// Fill for one return. If InboxCA cannot fill it, the reason shows under the button.
export function Fill({task,label}:{task:string;label:string}) {
  const [state,send]=useActionState<FillState,FormData>(fillNow,{});
  return <form action={send} className="fill-now">
    <input type="hidden" name="task" value={task}/>
    <Pending className="b b-secondary" busy="Filling" aria-label={`Fill ${label}`}>Fill</Pending>
    {state.error && <span className="fill-now-why" role="alert">{state.error}</span>}
  </form>;
}
