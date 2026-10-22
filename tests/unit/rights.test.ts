import { describe, expect, it } from "vitest";
import { may, mayDecide, routeOf } from "@/src/lib/rights";

describe("permissions", () => {
  // #47: the same limits apply to personal grants and role switches.
  it("keeps filing defaults, client scopes and inclusive end dates separate from owner rights",()=>{
    expect(may("staff","check_figures")).toBe(true);
    expect(may("staff","check_figures",{employee:{check_figures:false}})).toBe(false);
    const grant={right:"edit_figures" as const,clients:["a"],until:"2026-10-22"};
    expect(may("staff","edit_figures",{},[grant],"a","2026-10-22")).toBe(true);
    expect(may("staff","edit_figures",{},[grant],"b","2026-10-22")).toBe(false);
    expect(may("staff","edit_figures",{},[grant],"a","2026-10-23")).toBe(false);
    expect(may("staff","edit_figures",{},[grant],undefined,"2026-10-22")).toBe(false);
    const permissions={employee:{upload:true,scope:{clients:["a"],until:"2026-10-22"}}};
    expect(may("staff","upload",permissions,[],"a","2026-10-22")).toBe(true);
    expect(may("staff","upload",permissions,[],"b","2026-10-22")).toBe(false);
    expect(may("staff","upload",permissions,[],"a","2026-10-23")).toBe(false);
    expect(may("owner","upload",permissions,[],"b","2026-10-23")).toBe(true);
  });
  // #21, #27, #47: grants widen the action, never owner only rights.
  it("lets the owner do everything; others ask, unless the owner switched a right on; removing stays the owner's", () => {
    expect(may("owner", "remove")).toBe(true);
    expect(may("staff", "upload")).toBe(false);
    expect(may("manager", "send")).toBe(false);
    expect(may("staff", "upload", { employee: { upload: true } })).toBe(true);
    expect(may("partner", "upload", { manager: { upload: true } })).toBe(true);
    expect(may("manager", "remove", { manager: { upload: true, send: true } })).toBe(false);
    // Always allowed for one person: that right only, and never removing.
    expect(may("front_desk", "upload", {}, ["upload"])).toBe(true);
    expect(may("front_desk", "send", {}, ["upload"])).toBe(false);
    expect(may("staff", "remove", {}, ["remove"])).toBe(false);
  });
  // #18, #44, #45: a manager never receives their own question or a delete.
  it("routes an employee's request to their team's manager, and everything else to the owner or a deputy", () => {
    expect(routeOf("upload", { role: "staff", team_id: "gst" }, ["priya"])).toBe("manager");
    expect(routeOf("remove", { role: "staff", team_id: "gst" }, ["priya"])).toBe("owner");
    expect(routeOf("upload", { role: "manager", team_id: "gst" }, ["priya"])).toBe("owner");
    expect(routeOf("upload", { role: "staff", team_id: null }, [])).toBe("owner");
  });
  // #42, #44: no self approval, including deputies.
  it("never lets anyone answer their own request, and keeps managers to their team's everyday requests", () => {
    const request = { by: "ravi", route: "manager" as const, team_id: "gst" };
    expect(mayDecide({ id: "priya", role: "manager", team_id: "gst", deputy: false }, request)).toBe(true);
    expect(mayDecide({ id: "asha", role: "manager", team_id: "it", deputy: false }, request)).toBe(false);
    expect(mayDecide({ id: "priya", role: "manager", team_id: "gst", deputy: false }, { ...request, route: "owner" })).toBe(false);
    expect(mayDecide({ id: "ravi", role: "owner", team_id: null, deputy: false }, request)).toBe(false);
    expect(mayDecide({ id: "ravi", role: "partner", team_id: null, deputy: true }, request)).toBe(false);
    expect(mayDecide({ id: "ravi", role: "manager", team_id: "gst", deputy: false }, request)).toBe(false);
    expect(mayDecide({ id: "kiran", role: "partner", team_id: null, deputy: true }, { ...request, route: "owner" })).toBe(true);
  });
});
