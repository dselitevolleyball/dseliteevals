// Product board - what both the server (api/product*.js) and the board
// (src/ProductBoard.jsx) need to agree on: the columns, the repos an agent may
// work in, and how each one builds.

export const STATUSES = [
  ["inbox", "Inbox", "#a78bfa"],
  ["backlog", "Backlog", "#9ca3af"],
  ["planned", "Planned", "#60a5fa"],
  ["building", "Building", "#f59e0b"],
  ["review", "In review", "#e91e8c"],
  ["shipped", "Shipped", "#22c55e"],
  ["declined", "Declined", "#6b7280"],
  ["canceled", "Canceled", "#6b7280"],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map(([k, l]) => [k, l]));
export const KINDS = [["feature", "New feature"], ["improvement", "Make it better"], ["bug", "Something's broken"]];
export const PRIORITIES = [[0, "No priority"], [1, "Urgent"], [2, "High"], [3, "Medium"], [4, "Low"]];
export const AREAS = ["DS Elite HQ", "DSSC HQ", "Marketing", "Time cards & pay", "Texts & email", "DS Elite website", "DSSC website", "Other"];

// Where an agent can work. `author` is who the commits are made as: each
// Vercel project only deploys commits by a member of its team (the website
// was BLOCKED for a drippingsportsclub.com author on Oct 27 2026).
export const REPOS = {
  "dselitevolleyball/dseliteevals": {
    label: "HQ app (DS Elite + DSSC)", node: "22", install: "npm ci", build: "npx vite build",
    author: { name: "Drew Rose", email: "drew@drippingsportsclub.com" },
  },
  "dselitevolleyball/dselite-website": {
    label: "DS Elite website", node: "24", install: "npm ci", build: "npx astro build",
    author: { name: "Drew Rose", email: "drew@dselitevolleyball.com" },
  },
  "drew-dssc/dssc-investor-network": {
    label: "DSSC website", node: "22", install: "npm ci", build: "npm run build",
    author: { name: "Drew Rose", email: "drew@drippingsportsclub.com" },
  },
};
export const repoFor = (area) => area === "DS Elite website" ? "dselitevolleyball/dselite-website" : area === "DSSC website" ? "drew-dssc/dssc-investor-network" : "dselitevolleyball/dseliteevals";
export const WORKFLOW_FILE = "feature-agent.yml";
export const itemKey = (id) => `HQ-${id}`;
export const branchFor = (id) => `agent/hq-${id}`;
