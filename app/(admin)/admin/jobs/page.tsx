import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { CountPill, PageHead } from "@/app/(app)/app/ui";
import { retryJob } from "../actions";
import { currentAdmin, jobName, retryWords, when } from "../admin";
import { Submit } from "../parts";

// The two codes the worker gives a job it stopped part way (claim_jobs).
const stopped: Record<string, string> = {
  uncertain: "Stopped while sending. It may have gone: check before you try again.",
  lease_expired: "The worker stopped while running it, again and again.",
};

// Jobs that ran out of tries or stopped part way, by firm (the firm with the newest first),
// each firm opening to its jobs, newest first, each with one button to try again.
export default async function AdminJobs() {
  const { supabase } = await currentAdmin();
  const { data: jobs, error } = await supabase.rpc("admin_failed_jobs");
  if (error) throw new Error(`Admin jobs failed: ${error.code}`);
  const firms = [...Map.groupBy(jobs, (job) => job.firm_id ?? "")];
  return (
    <>
      <PageHead title="Failed jobs" sub={`Work that ran out of tries or stopped part way, by firm. Failed jobs are kept 30 days.${jobs.length >= 200 ? " Showing the newest 200." : ""}`} />
      <section className="admin-card" aria-label="Failed jobs">
        {firms.length ? firms.map(([id, list]) => (
          <details className="admin-group" key={id}>
            <summary className="admin-row">
              <div className="grow">
                <strong>{list[0].firm ?? "Orelu"}</strong>
                <span className="sub">{[...Map.groupBy(list, (job) => job.kind)].map(([kind, same]) => `${jobName(kind)}${same.length > 1 ? ` ${same.length}` : ""}`).join(", ")}. Last {when(list[0].at)}</span>
              </div>
              {id && <Link href={`/admin/firms/${id}`}>Open the firm</Link>}
              <CountPill tone="late" label={`${list.length} failed`}>{list.length}</CountPill>
              <ChevronDown size={16} aria-hidden />
            </summary>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr><th>Job</th><th>Error</th><th>Tries</th><th>Last tried</th><th className="shrink"><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {list.map((job) => (
                    <tr key={job.id}>
                      <td>{jobName(job.kind)}</td>
                      <td><span className="num">{job.error ?? "None"}</span>{job.error && stopped[job.error] && <span className="sub">{stopped[job.error]}</span>}</td>
                      <td className="num">{job.attempts}</td>
                      <td className="num">{when(job.at)}</td>
                      <td className="shrink">
                        <form action={retryJob}>
                          <input type="hidden" name="job" value={job.id} />
                          <Submit confirm={retryWords(job.error)}>Try again</Submit>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )) : (
          <p className="admin-empty"><strong>No failed jobs</strong>Everything ran.</p>
        )}
      </section>
    </>
  );
}
