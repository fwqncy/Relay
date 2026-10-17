import type { Appearance } from './theme';

export type Role = 'manager' | 'employee';
export type TransportMode = 'sea' | 'road' | 'rail' | 'air';

export interface Company {
  id: string;
  name: string;
  initials: string;
  hub: string;
  accentLight: string;
  accentDark: string;
}

export interface User {
  id: number;
  companyId: string;
  email: string;
  name: string;
  title: string;
  role: Role;
}

export interface JobKind {
  type: string;
  label: string;
  description: string;
  submit: 'all' | 'manager' | 'system';
}

export interface Me {
  user: User;
  company: Company;
  jobKinds: JobKind[];
  allKinds: JobKind[];
  settings: Appearance;
}

export interface DemoAccount {
  company: Company;
  name: string;
  title: string;
  email: string;
  role: Role;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job {
  id: number;
  type: string;
  status: JobStatus;
  attempts: number;
  payload: unknown;
  submittedBy: string | null;
  runId: number | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  worker: string | null;
  stolen: boolean;
  result: unknown;
  error: string | null;
  queueMs: number | null;
  durationMs: number | null;
}

export type RuntimeMode = 'work-stealing' | 'single-queue';

export interface Point {
  t: number;
  p50: number | null;
  p95: number | null;
  throughput: number;
  queued: number;
  mode: RuntimeMode;
}

export interface WorkerStats {
  id: string;
  utilization: number;
  processed: number;
  steals: number;
  local: number;
  busy: boolean;
}

export interface RunResult {
  id: number;
  mode: RuntimeMode;
  jobs: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
  startedAt: string;
  finishedAt: string;
}

export interface RunProgress {
  id: number;
  mode: RuntimeMode;
  total: number;
  done: number;
}

export interface JobTypeStats {
  type: string;
  total: number;
  failed: number;
  avgMs: number | null;
  stolen: number;
}

export interface RuntimeData {
  mode: RuntimeMode;
  workers: number;
  history: Point[] | null;
  changes: { at: string; mode: RuntimeMode }[];
  runs?: RunResult[] | null;
  types?: JobTypeStats[] | null;
  activeRuns?: RunProgress[] | null;
  workerStats?: WorkerStats[] | null;
  prefetch?: number;
}

export interface StreamMessage {
  mode: RuntimeMode;
  point?: Point;
  workers?: WorkerStats[];
  activeRuns?: RunProgress[] | null;
  unread?: number;
}

export type ShipmentStatus = 'booked' | 'in_transit' | 'delayed' | 'delivered' | 'cancelled';

export interface Shipment {
  id: number;
  reference: string;
  mode: TransportMode;
  status: ShipmentStatus;
  customer: string;
  carrier: string;
  origin: string;
  destination: string;
  weightKg: number;
  pieces: number;
  priority: 'standard' | 'express';
  bookedAt: string;
  departsAt: string;
  eta: string;
  departedAt: string | null;
  deliveredAt: string | null;
  itemId: number | null;
  itemName: string | null;
  quantity: number | null;
  progress: number;
  onTime: boolean | null;
}

export interface ShipmentEvent {
  at: string;
  kind: string;
  location: string;
  note: string;
}

export interface Tier {
  level: number;
  vehicle: string;
  title: string;
  description: string;
}

export interface RealmVehicle {
  id: number;
  reference: string;
  status: ShipmentStatus;
  progress: number;
  origin: string;
  destination: string;
  carrier: string;
  customer: string;
  eta: string;
}

export interface RealmMode {
  mode: TransportMode;
  name: string;
  xp: number;
  level: number;
  prevAt: number;
  nextAt: number;
  tier: Tier;
  tiers: Tier[];
  active: number;
  target: number;
  vehicles: RealmVehicle[];
}

export interface Milestone {
  key: string;
  mode: TransportMode | '';
  title: string;
  description: string;
  unlockedAt: string | null;
}

export interface RealmData {
  modes: RealmMode[];
  town: { staff: number; docks: number; skus: number; delivered: number; delayed: number };
  milestones: Milestone[];
}

export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  readAt: string | null;
}

export interface AuditEntry {
  id: number;
  actor: string | null;
  action: string;
  target: string;
  detail: string;
  at: string;
}

export interface TimeOff {
  id: number;
  userId: number;
  name: string;
  kind: 'vacation' | 'sick' | 'personal';
  startsOn: string;
  endsOn: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'withdrawn';
  decidedBy: string | null;
  decidedAt: string | null;
  note: string;
  createdAt: string;
  days: number;
}

export interface Item {
  id: number;
  sku: string;
  name: string;
  category: string;
  location: string;
  unit: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  reorderQty: number;
  inbound: number;
  updatedAt: string;
}

export interface Analytics {
  days: number;
  delivered: number;
  onTimePct: number | null;
  prevOnTimePct: number | null;
  delayed: number;
  active: number;
  weightKg: number;
  volume: { day: string; sea: number; road: number; rail: number; air: number }[];
  modes: { mode: TransportMode; delivered: number; onTimePct: number | null; avgTransitHours: number | null; active: number }[];
  carriers: { carrier: string; mode: TransportMode; delivered: number; onTimePct: number | null; avgTransitHours: number | null; delayed: number }[];
  lowStock: number;
  pendingTimeOff: number;
}

export interface SearchHit {
  kind: 'shipment' | 'item' | 'person' | 'appointment' | 'job';
  id: number;
  title: string;
  subtitle: string;
  link: string;
}

export interface Dock {
  id: number;
  name: string;
  kind: string;
}

export type AppointmentStatus = 'requested' | 'confirmed' | 'checked_in' | 'completed';

export interface Appointment {
  id: number;
  dockId: number;
  carrier: string;
  reference: string;
  direction: 'inbound' | 'outbound';
  pallets: number;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  assignedTo: number | null;
  assignee: string | null;
  checkedInAt: string | null;
}

export interface Staff {
  id: number;
  name: string;
  title: string;
  role: Role;
}

export interface Shift {
  id: number;
  userId: number;
  startsAt: string;
  endsAt: string;
  position: string;
  location: string;
  published: boolean;
}
