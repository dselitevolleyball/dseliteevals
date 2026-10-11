// Dev-only harness for src/ServeGrader.jsx: /?servepreview in `npm run dev`.
// In-memory serves and sample players, so the grader can be checked without
// signing in. main.jsx only loads this when import.meta.env.DEV.
import ServeGrader from "./ServeGrader.jsx";

const players = ["Maria Alves:4", "Emma Kobersky:9", "Juliette Pennock:12", "Hadley Willingham:2", "Reese Connell:7", "Stella Fullen:15"]
  .map((s, i) => { const [name, num] = s.split(":"); const [first_name, last_name] = name.split(" "); return { id: i + 1, first_name, last_name, jersey_number: num, team_assignment: "14 Ruby", offer_status: "accepted" }; });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
let id = 1;
const store = [];
if (typeof window !== "undefined") window.__serveStore = store; // for checks in the browser
for (const [ago, pid, type, a, t] of [[6, 1, "float", 2, 2], [6, 1, "float", 0, null], [6, 1, "fast", 3, 3], [6, 2, "float", 1, 1], [3, 1, "float", 3, 2], [3, 2, "fast", 0, null], [3, 2, "fast", 2, 3]])
  store.push({ id: id++, player_id: pid, team_name: "14 Ruby", session_date: day(ago), serve_type: type, accuracy: a, toughness: t, score: a === 0 ? 0 : a * t, created_at: new Date().toISOString() });
export const api = {
  load: async (team) => store.filter(r => r.team_name === team),
  insert: async (row) => { await new Promise(res => setTimeout(res, 900)); const r = { ...row, id: id++, created_at: new Date().toISOString() }; store.push(r); return r; }, // slow, like gym wifi
  _store: store,
  remove: async (rid) => { const i = store.findIndex(r => r.id === rid); if (i >= 0) store.splice(i, 1); },
};
export default function ServePreview() {
  return <div style={{ fontFamily: "Outfit,sans-serif", background: "#0a0a0a", color: "#fff", minHeight: "100vh", padding: "14px 18px" }}>
    <ServeGrader coach={{ display_name: "Preview Coach" }} players={players} teams={["14 Ruby", "15 Ruby"]} api={api} />
  </div>;
}
