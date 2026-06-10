// Architecture Diagram OS — internal icon mapping layer.
// The architectureSpec uses generic icon keys; this maps them to lucide-react
// components already installed in the app. No internet hotlinking — official
// AWS/Azure/GCP SVG packs can be slotted in here later without touching specs.
import {
  User, Globe, Shield, Network, Monitor, Server, Database, Zap, List, Archive,
  Cpu, Activity, Key, GitBranch, Box, Brain, Search, Clock, Workflow, FileText,
  Bell, Gauge, CreditCard, Route, Boxes,
} from 'lucide-react';

export const capabilityIconMap = {
  user: User,
  cdn: Globe,
  globe: Globe,
  waf: Shield,
  shield: Shield,
  apiGateway: Network,
  network: Network,
  frontend: Monitor,
  monitor: Monitor,
  backend: Server,
  server: Server,
  database: Database,
  cache: Zap,
  zap: Zap,
  queue: List,
  list: List,
  objectStorage: Archive,
  archive: Archive,
  worker: Cpu,
  cpu: Cpu,
  monitoring: Activity,
  activity: Activity,
  secrets: Key,
  key: Key,
  cicd: GitBranch,
  gitBranch: GitBranch,
  container: Box,
  box: Box,
  ai: Brain,
  brain: Brain,
  search: Search,
  clock: Clock,
  workflow: Workflow,
  fileText: FileText,
  bell: Bell,
  gauge: Gauge,
  creditCard: CreditCard,
  route: Route,
  externalSystem: Boxes,
};

/* Resolve a node's icon component: explicit icon key → capability → fallback. */
export function iconFor(node = {}) {
  return capabilityIconMap[node.icon] || capabilityIconMap[node.capability] || Box;
}

export default capabilityIconMap;
