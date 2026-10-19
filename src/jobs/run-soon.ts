import { after } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase";
import { apiJobStore } from "./api-store";
import { handlers } from "./handlers";
import { runDueJobs } from "./runner";

// Runs due jobs right after this response, so a question reaches its approver in seconds
// rather than at the next minute's sweep. Claims keep it from running a job twice.
export const runJobsSoon = () => after(() => runDueJobs(apiJobStore(supabaseAdmin()), handlers).then(() => undefined, () => undefined));
