import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { draftSchema } from "@/src/lib/datasets";
import { periodName } from "@/src/lib/documents";
import { itrYear } from "@/src/lib/itr-fields";
import { currentMember } from "@/src/lib/member";
import { formName, preparedSchema } from "@/src/lib/prepared";
import { personName } from "@/src/lib/roles";
import { signoffLines, whenWords } from "@/src/lib/signoffs";
import { PageHead } from "../../../ui";
import { PrintButton } from "./print-button";
import "../../../returns.css";

// One page working paper for a prepared return (ICAI SQC 1 / SA 230 keep the firm's papers):
// which source figures it was made from, who checked them, who prepared, approved and filed
// the return and when. Read as the signed in person, so it shows only for a client they may
// see. Figures themselves stay in the return file; this page names sources and sign offs only.
export default async function WorkingPaper({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { data: file } = await supabase.from("documents").select("id, client_id, name, period_key, prepared, received_at, clients(name)").eq("firm_id", membership.firmId).eq("id", id).not("prepared", "is", null).neq("status", "deleted").maybeSingle();
  if (!file) notFound();
  const meta = preparedSchema.parse(file.prepared);
  const [{ data: signoffs }, { data: people }, { data: sources }] = await Promise.all([
    supabase.rpc("form_signoffs", { target_firm: membership.firmId, docs: [id] }),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("datasets").select("id, form_code, period_key, revision, data").eq("firm_id", membership.firmId).eq("client_id", file.client_id).in("id", meta.sources.map((source) => source.id)),
  ]);
  const emailOf = (person: string | null) => people?.find((one) => one.user_id === person)?.email;
  const drafts = (sources ?? []).map((row) => ({ ...row, data: draftSchema.parse(row.data) }));
  const papers = [...new Set(drafts.flatMap((row) => (row.data.lines[0]?.source.document ? [row.data.lines[0].source.document] : [])))];
  const { data: names } = papers.length ? await supabase.from("documents").select("id, name").eq("firm_id", membership.firmId).eq("client_id", file.client_id).in("id", papers) : { data: null };
  const period = meta.form.startsWith("ITR") ? itrYear(file.period_key) : periodName(file.period_key);
  const steps = signoffLines(signoffs, id, emailOf);
  const title = `${formName(meta.form)} for ${file.clients?.name ?? ""}, ${period}`;
  return (
    <div className="wp">
      <PageHead title="Working paper" sub={`${title}. ${membership.firmName}.`} actions={<span className="wp-actions"><Link className="b b-secondary" href={`/app/files/${id}/view`}>Back to the return</Link><PrintButton /></span>} />
      <h2>Return</h2>
      <table>
        <tbody>
          <tr><th>Client</th><td>{file.clients?.name}</td></tr>
          <tr><th>Return</th><td>{formName(meta.form)}, {period}</td></tr>
          <tr><th>File</th><td>{file.name}. Official version {meta.template}, InboxCA version {meta.version}.{meta.external && " Corrected outside InboxCA."}</td></tr>
          <tr><th>Standing</th><td>{meta.status === "filed" ? "Filed" : meta.status === "approved" ? "Approved, not yet marked filed" : meta.status === "rejected" ? "Sent back for correction" : "Draft, waiting for approval"}</td></tr>
        </tbody>
      </table>
      <h2>Sources</h2>
      <table>
        <thead><tr><th>Source</th><th>Figures</th><th>Checked by</th></tr></thead>
        <tbody>
          {meta.sources.map((source) => {
            const draft = drafts.find((row) => row.id === source.id);
            if (!draft) return <tr key={source.id}><th>Source no longer available</th><td /><td /></tr>;
            const checked = draft.data.lines.filter((line) => line.state === "confirmed");
            const checkers = [...new Set(checked.map((line) => line.by ?? ""))].filter(Boolean);
            const lastCheck = checked.map((line) => line.at ?? "").sort().at(-1);
            const name = draft.form_code === "GSTR3B" ? "GSTR-2B credit" : draft.data.target ? "Figures entered by the team" : names?.find((paper) => paper.id === draft.data.lines[0]?.source.document)?.name ?? "Figures from a paper";
            return (
              <tr key={source.id}>
                <th>{name}<br /><span className="hint">Revision {source.revision}{draft.revision !== source.revision && ` (now ${draft.revision})`}</span></th>
                <td>{draft.data.lines.length}, {checked.length} checked</td>
                <td>{checkers.length ? `${checkers.map((person) => personName(emailOf(person))).join(", ")}${lastCheck ? `, last on ${whenWords(lastCheck)}` : ""}` : "Nobody yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Sign off</h2>
      <table>
        <tbody>
          {steps.length ? steps.map((step) => <tr key={step.action}><th>{step.line.split(" by ")[0]}</th><td>{step.who}, {step.when}</td></tr>) : <tr><th>Nothing recorded yet</th><td /></tr>}
        </tbody>
      </table>
      <p className="hint">Printed from InboxCA on {whenWords(new Date().toISOString())}. The figures are in the return file; this page lists its sources and who signed off.</p>
    </div>
  );
}
