import { PageHead } from "@/app/(app)/app/ui";
import { retryJob } from "../actions";
import { currentAdmin, when } from "../admin";
import { Submit } from "../parts";

// Jobs that ran out of tries, newest first, each with one button to try again.
export default async function AdminJobs() {
  const { supabase } = await currentAdmin();
  const { data: jobs, error } = await supabase.rpc("admin_failed_jobs");
  if (error) throw new Error(`Admin jobs failed: ${error.code}`);
  return (
    <>
      <PageHead title="Failed jobs" sub="Work that ran out of tries. Failed jobs are kept 30 days." />
      <section className="admin-card" aria-label="Failed jobs">
        {jobs.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Job</th><th>Firm</th><th>Error</th><th>Tries</th><th>Last tried</th><th className="shrink"><span className="sr-only">Action</span></th></tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="num">{job.kind}</td>
                    <td><strong>{job.firm ?? "Orelu"}</strong></td>
                    <td className="num">{job.error ?? "None"}</td>
                    <td className="num">{job.attempts}</td>
                    <td className="num">{when(job.at)}</td>
                    <td className="shrink">
                      <form action={retryJob}>
                        <input type="hidden" name="job" value={job.id} />
                        <Submit>Try again</Submit>
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
    </>
  );
}
