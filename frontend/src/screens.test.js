/**
 * Every screen has to render, with data.
 *
 * Two blank pages reached production in one go. The first was naming a `const`
 * in a useEffect dependency array two lines before that const was declared. The
 * second was a component used without its import. Both compiled, both passed
 * lint, the bundle contained all the right strings and every API they call
 * answered correctly — and both threw at runtime and took the whole page down.
 *
 * So this renders each screen for real, with the requests resolved, and fails
 * on anything thrown. Resolving matters: the missing import sat below an early
 * `if (!docs) return <p>Loading…</p>`, so a render that never received its data
 * would have sailed straight past it — which is exactly what happened.
 *
 * It asserts nothing about how a screen looks. It asserts they run.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const project = {
  id: "p1", name: "45 Banquet drive", client_name: "C", status: "active",
  site_suburb: "Tarneit", site_postcode: "3029", progress: 12, contract_value: 620000,
  project_type: "new-build", target_completion: "2027-06-30", start_date: "2026-09-01",
};
const pkg = {
  id: "pkg1", package_id: "pkg1", title: "Plumbing Rough-in & Fit-off", trade_type: "plumber",
  status: "quotes-in", state: "decide", step: 13, step_name: "Plumbing rough-in",
  scope: "s", stage_key: "lockup", estimate_total: 1000, best_quote: 1100,
  awarded_amount: null, invoiced: 0, paid: 0, outstanding: 0, overdue_count: 0,
  live_quote_count: 1, invited: 2, replied: 1, days_since_sent: 4,
  next_action: { id: "award", label: "Award" },
};
const item = {
  n: 1, key: "permit-obtained", kind: "permit", name: "Obtain the building permit",
  action_key: "a:permit-obtained", status: "todo", note: "", due_date: null,
  reference: "", document_id: null, completed_at: null, external: true, trade: null,
};

// Plausible shapes for what each screen fetches, matched on the tail of the
// path. Anything unmatched comes back empty, which is a state a screen must
// survive anyway.
const RESPONSES = {
  "/board": {
    rows: [pkg],
    sequence: [{ n: 1, key: "pre-start", name: "Pre-start", mandatory: false, packages: [], state: "current" }],
    current_step: { n: 1, key: "pre-start", name: "Pre-start", detail: "d", mandatory: false },
    needs_pricing_soon: [],
    totals: { estimate: 1000, committed: 0, invoiced: 0, paid: 0, outstanding: 0,
              unallocated_invoiced: 0, package_count: 1, priced_count: 1,
              committed_count: 0, needs_you: 1 },
  },
  "/steps": {
    phases: [{ key: "a", letter: "A", name: "Before construction starts", detail: "d",
               hold: false, steps: [{ n: 1, name: "Pre-start" }], packages: [],
               trades: [{ key: "t", work: "Site establishment", trade_type: "other",
                          package: null, suggested: {} }],
               unbooked: 1, items: [item], done: 0, total: 1, outstanding: 1,
               complete: false, current: true }],
    current_phase: "a", current_phase_name: "Before construction starts",
    items_done: 0, items_total: 1, reminders: [], reminder_count: 0, hold_points: [],
    unbooked_trades: [{ key: "t", work: "Site establishment", phase_key: "a",
                        phase_letter: "A", phase_name: "n", step: 1, package: null,
                        suggested: {} }],
    ongoing: ["Keep the current stamped drawings on site."], footnote: "f",
  },
  "/timeline": {
    basis: "backwards from handover", target_completion: "2027-06-30",
    start_date: "2026-09-01", planned_start: "2026-09-01", planned_finish: "2027-06-30",
    build_days: 125, build_weeks: 25, today: "2026-09-05", current_step: 1,
    // Enough of a road to exercise the drawing: a step behind you, the one you
    // are on, a hold point you cannot pass, and the finish.
    steps: [
      { n: 1, key: "pre-start", name: "Pre-start preparation", detail: "d", mandatory: false,
        days: 10, parallel: false, start: "2026-08-03", finish: "2026-08-14",
        state: "done", behind: false, packages: [], booked_start: null },
      { n: 2, key: "site-cut", name: "Site cut and excavation", detail: "d", mandatory: false,
        days: 5, parallel: false, start: "2026-08-17", finish: "2026-08-21",
        state: "current", behind: true, packages: [{ id: "pkg1", title: "Site Prep", status: "draft", scheduled_start: null }],
        booked_start: null },
      { n: 5, key: "pre-slab-inspection", name: "Footing / pre-slab inspection", detail: "d",
        mandatory: true, days: 2, parallel: false, start: "2026-09-10", finish: "2026-09-11",
        state: "ahead", behind: false, packages: [], booked_start: null },
      { n: 14, key: "electrical-rough-in", name: "Electrical rough-in", detail: "d",
        mandatory: false, days: 4, parallel: true, start: "2026-11-02", finish: "2026-11-05",
        state: "ahead", behind: false, packages: [], booked_start: null },
      { n: 25, key: "occupancy", name: "Final inspection and Occupancy Permit", detail: "d",
        mandatory: false, days: 10, parallel: false, start: "2027-06-17", finish: "2027-06-30",
        state: "ahead", behind: false, packages: [], booked_start: null },
    ],
    orders: [{ key: "frames-trusses", name: "Frames and trusses", lead_weeks: 8,
               note: "n", trade: "carpenter-frame", supply_package: null,
               installer_package: null, installer_work: "Frame and trusses",
               needed_step: 7, needed_step_name: "Wall frames", needed_by: "2026-12-01",
               order_by: "2026-10-06", measured_on_site: false, days_left: 31,
               status: "soon" }],
    on_track: true, steps_behind: 0, orders_overdue: 0, start_has_passed: false,
  },
  "/trade-gaps": { unbooked: [] },
  "/next-steps": { actions: [], done: [], badges: {},
                   current_stage: { n: 1, key: "pre-start", name: "Pre-start", of: 25 },
                   checklist: { phase: "A", done: 0, total: 193 } },
  "/roadmap": { overall_progress: 12,
                stages: [{ key: "base", label: "Base", weight: 10, progress: 20,
                           tasks: [], total_count: 0 }] },
  "/budget": { project_id: "p1", by_stage: [], by_work_package: [],
               totals: { estimated: 0, estimate_with_contingency: 0, contingency_pct: 10,
                         committed: 0, invoiced: 0, paid: 0, exposure: 0,
                         health: "on-budget", contract_value: 620000,
                         approved_variations_total: 0, adjusted_contract_value: 620000 } },
  "/estimate": { project_id: "p1", lines: [],
                 summary: { subtotal_ex_gst: 0, gst: 0, contingency_pct: 10,
                            contingency_amount: 0, grand_total: 0, contract_value: 620000,
                            margin: 0, margin_pct: 0 } },
  "/invoices": { invoices: [],
                 summary: { total_invoiced: 0, total_paid: 0, outstanding: 0, overdue_count: 0 } },
  "/claims": { lines: [], contract_value: 620000 },
  "/dashboard": { portfolio: [], hold_points: [], checklist_overdue: [],
                  overdue_invoices: { count: 0, total_balance: 0, items: [] },
                  trade_warnings: [], upcoming_tasks: [], claims_snapshot: [] },
  "/integrations/gmail": { connected: false, configured: false, aliases: [] },
  "/agent/health": { ok: true },
};

const respond = (url = "") => {
  for (const [tail, body] of Object.entries(RESPONSES)) {
    if (url.endsWith(tail)) return { data: body };
  }
  if (url.endsWith("/projects")) return { data: [project] };
  if (/\/projects\/[^/?]+$/.test(url)) return { data: project };
  if (url.endsWith("/packages")) return { data: [pkg] };
  return { data: [] };
};

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: (url) => Promise.resolve(global.__respond(url)),
    post: () => Promise.resolve({ data: {} }),
    put: () => Promise.resolve({ data: {} }),
    delete: () => Promise.resolve({ data: {} }),
    patch: () => Promise.resolve({ data: {} }),
  },
  formatApiErrorDetail: (d) => d,
  readBlobError: async () => "",
  downloadBlob: () => {},
}));

// Ships untranspiled ESM that CRA's jest will not transform, and nothing here
// is testing a third-party calendar.
jest.mock("react-day-picker", () => ({ DayPicker: () => null }));

jest.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
  Toaster: () => null,
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Shubendhu Mahajan", email: "pm@rldtech.com.au" },
    login: async () => {}, register: async () => {}, logout: () => {},
  }),
  AuthProvider: ({ children }) => children,
}));

beforeAll(() => {
  global.__respond = respond;               // the mock is hoisted above respond
  Element.prototype.scrollIntoView = () => {};   // jsdom has no layout
  global.IS_REACT_ACT_ENVIRONMENT = true;
});

/** Mount, let every promise settle and every effect run, then read the text. */
async function render(node, entries = ["/"]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={entries}>{node}</MemoryRouter>);
  });
  await act(async () => {});
  const text = host.textContent || "";
  await act(async () => { root.unmount(); });
  host.remove();
  return text;
}

describe("every screen renders with data", () => {
  it("the job page, on each of its seven screens", async () => {
    const Page = require("@/pages/ProjectDetailPage").default;
    for (const tab of ["", "steps", "timeline", "drawings", "money", "diary", "overview"]) {
      const at = tab ? `/projects/p1?tab=${tab}` : "/projects/p1";
      const text = await render(<Page />, [at]);
      expect(text).toContain("45 Banquet drive");
      // A page showing only its header is what a blank screen looks like.
      expect(text.length).toBeGreaterThan(250);
    }
  });

  it("the board, including the row-focus path from the checklist", async () => {
    const { TradeBoard } = require("@/components/TradeBoard");
    expect(await render(<TradeBoard projectId="p1" />)).toContain("Plumbing Rough-in");
    expect(await render(<TradeBoard projectId="p1" focusPackageId="pkg1" />))
      .toContain("Plumbing Rough-in");
  });

  it("the tabs inside a job, past their loading state", async () => {
    const cases = [
      ["checklist", require("@/components/BuildStepsTab").BuildStepsTab,
       { projectId: "p1", onGoToBoard: () => {} }, "Before construction starts"],
      ["timeline", require("@/components/TimelineTab").TimelineTab,
       { project, onChanged: () => {} }, "Frames and trusses"],
      ["the road itself", require("@/components/BuildRoad").BuildRoad,
       { steps: RESPONSES["/timeline"].steps, orders: RESPONSES["/timeline"].orders,
         today: "2026-09-05" }, "Site cut and excavation"],
      ["the journey overview", require("@/components/RoadOverview").RoadOverview,
       { steps: RESPONSES["/timeline"].steps, currentStep: 2 }, "Where you are"],
      ["money", require("@/components/MoneyTab").MoneyTab, { project }, "Budget tracking"],
      ["drawings", require("@/components/DrawingsTab").DrawingsTab,
       { project, onChanged: () => {} }, "Files on this job"],
      ["documents", require("@/components/DocumentsTab").DocumentsTab,
       { projectId: "p1" }, "Add files"],
      ["job details", require("@/components/ProjectOverview").ProjectOverview,
       { project, onChanged: () => {} }, "DBI policy"],
      ["quick upload", require("@/components/QuickUpload").QuickUpload,
       { projectId: "p1", onUploaded: () => {} }, "Upload"],
      ["assistant", require("@/components/ChatPanel").ChatPanel,
       { projectId: "p1", projectName: "x" }, "Ask"],
    ];
    for (const [name, Component, props, expected] of cases) {
      const text = await render(<Component {...props} />);
      if (!text.includes(expected)) {
        throw new Error(`${name} did not render — expected to find "${expected}"`);
      }
    }
  });

  it("the top-level pages, and the shell around them", async () => {
    const { AppShell } = require("@/components/AppShell");
    expect(await render(React.createElement(require("@/pages/ProjectsPage").default)))
      .toContain("45 Banquet drive");
    expect(await render(React.createElement(require("@/pages/TradesPage").default)))
      .toContain("Tradies");
    expect(await render(React.createElement(require("@/pages/SettingsPage").default)))
      .toContain("Gmail");
    // Signed in, so the login page redirects and renders nothing. That it
    // redirects rather than throwing is the whole assertion.
    expect(await render(React.createElement(require("@/pages/LoginPage").default)))
      .toBe("");
    expect(await render(<AppShell />)).toContain("Jobs");
  });
});
