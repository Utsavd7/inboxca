import { redirect } from "next/navigation";
import { PageHead } from "@/app/(app)/app/ui";
import { retryJob } from "../actions";
import { currentAdmin, jobName, PAGE, pageRows, retryWords, when } from "../admin";
import { Pager, Submit } from "../parts";

// The two codes the worker gives a job it stopped part way (claim_jobs).
const stopped: Record<string, string> = {
  uncertain: "Stopped while sending. It may have gone: check before you try again.",
  lease_expired: "The worker stopped while running it, again and again.",
};

// Jobs that ran out of tries or stopped part way, newest first, each with one button to try again.
export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { supabase } = await currentAdmin();
  const { page, from, to } = pageRows((await searchParams).page);
  const { data: jobs, count, error } = await supabase.rpc("admin_failed_jobs", undefined, { count: "exact" }).range(from, to);
  if (error?.code === "PGRST103") redirect("/admin/jobs");
  if (error) throw new Error(`Admin jobs failed: ${error.code}`);
  return (
    <>
      <PageHead title="Failed jobs" sub="Work that ran out of tries or stopped part way. Failed jobs are kept 30 days." />
      <section className="admin-card" aria-label="Failed jobs">
        {jobs.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Firm</th><th>Job</th><th>Error</th><th>Tries</th><th>Last tried</th><th className="shrink"><span className="sr-only">Action</span></th></tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td><strong>{job.firm ?? "Orelu"}</strong></td>
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
        ) : (
          <p className="admin-empty"><strong>No failed jobs</strong>Everything ran.</p>
        )}
      </section>
      <Pager page={page} size={PAGE} total={count ?? 0} label="Failed job pages" />
    </>
  );
}
