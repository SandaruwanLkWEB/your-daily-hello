import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflowApi } from '@/hooks/useWorkflowApi';
import CapacityWarningBanner from '@/components/workflow/CapacityWarningBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft, Send, CheckCircle, AlertTriangle, Loader2,
  Calendar, ChevronDown, Bus, Truck, User, Phone, MapPin, Route, Clock, Map, Scissors, Undo2, X,
} from 'lucide-react';

/**
 * Effective capacity: capacity + overflow allowance.
 * Uses vehicle.soft_overflow if set > 0, else type defaults (VAN=4, BUS=10).
 * Must match GroupingService.getEffectiveCapacity on backend.
 */
const TYPE_OVERFLOW_DEFAULTS: Record<string, number> = { VAN: 4, BUS: 10 };
function getEffectiveCapacity(v: { capacity: number; soft_overflow?: number; type?: string }): number {
  const overflow = (v.soft_overflow != null && v.soft_overflow > 0)
    ? v.soft_overflow
    : (TYPE_OVERFLOW_DEFAULTS[(v.type || '').toUpperCase()] ?? 0);
  return v.capacity + overflow;
}

interface VehicleData {
  id: number;
  registration_no: string;
  type: string;
  capacity: number;
  soft_overflow?: number;
  driver_name?: string;
  driver_phone?: string;
  driver_license_no?: string;
  is_active?: boolean;
}

interface GroupData {
  id: number;
  group_code: string;
  corridor_code?: string;
  corridor_label?: string;
  employee_count: number;
  status: string;
  recommended_vehicle_id?: number;
  assigned_vehicle_id?: number;
  assigned_vehicle_reg?: string;
  driver_name?: string;
  driver_phone?: string;
  has_permanent_driver?: boolean;
  overflow_allowed?: boolean;
  overflow_count?: number;
  recommendation_reason?: string;
  cluster_note?: string;
  estimated_distance_km?: number;
  estimated_duration_seconds?: number;
  routing_source?: string;
  route_geometry?: number[][];
  members?: any[];
  // Backend capacity truth fields
  fits_single_vehicle?: boolean;
  fits_single_vehicle_with_overflow?: boolean;
  requires_split?: boolean;
  assignment_block_reason?: string;
}

interface RunData {
  id: number;
  run_number: number;
  total_groups: number;
  total_employees: number;
  unresolved_count: number;
  summary?: string;
  routing_source?: string;
  routing_warning?: string;
  groups?: GroupData[];
  parameters?: any;
  daily_run_id?: number;
  daily_run_status?: string;
  request_count?: number;
  department_count?: number;
}

export default function TaAssignmentBoardPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const wfApi = useWorkflowApi();
  const [run, setRun] = useState<RunData | null>(null);
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Multi-vehicle split state
  const [splitGroupId, setSplitGroupId] = useState<number | null>(null);
  const [selectedSplitVehicles, setSelectedSplitVehicles] = useState<number[]>([]);
  const [splitting, setSplitting] = useState(false);

  useEffect(() => {
    if (!date) return;
    setPageLoading(true);
    (async () => {
      try {
        const v = await wfApi.fetchVehicles();
        setVehicles(v);
        const runData = await wfApi.fetchDailyGroupingRun(date);
        if (runData) {
          setRun(runData);
          setGroups(runData.groups || []);
        }
      } catch { /* shown by hook */ } finally {
        setPageLoading(false);
      }
    })();
  }, [date]);

  const handleAssignVehicle = async (groupId: number, vehicleId: string) => {
    const vid = Number(vehicleId);
    const vehicle = vehicles.find(x => x.id === vid);
    if (!vehicle) return;
    try {
      const result: any = await wfApi.assignVehicle(groupId, vid);
      setGroups(gs => gs.map(g => g.id === groupId ? {
        ...g,
        assigned_vehicle_id: vid,
        assigned_vehicle_reg: result?.assigned_vehicle_reg || vehicle.registration_no,
        driver_name: result?.driver_name || vehicle.driver_name,
        driver_phone: result?.driver_phone || vehicle.driver_phone,
        has_permanent_driver: result?.has_permanent_driver ?? !!vehicle.driver_name,
        status: 'CONFIRMED',
      } : g));
    } catch { /* shown by hook */ }
  };

  const handleUnassign = async (groupId: number) => {
    try {
      await wfApi.unassignVehicle(groupId);
      setGroups(gs => gs.map(g => g.id === groupId ? {
        ...g,
        assigned_vehicle_id: undefined,
        assigned_vehicle_reg: undefined,
        driver_name: undefined,
        driver_phone: undefined,
        has_permanent_driver: undefined,
        status: 'PENDING',
      } : g));
    } catch { /* shown by hook */ }
  };

  const handleUndoSplit = async (subGroupId: number) => {
    try {
      const result: any = await wfApi.undoSplit(subGroupId);
      if (result?.mergedGroupId) {
        // Reload the full run data to get the merged group
        if (date) {
          const runData = await wfApi.fetchDailyGroupingRun(date);
          if (runData) {
            setRun(runData);
            setGroups(runData.groups || []);
          }
        }
      }
    } catch { /* shown by hook */ }
  };

  const handleSplitAssign = async (groupId: number) => {
    if (selectedSplitVehicles.length < 2) return;
    setSplitting(true);
    try {
      const result: any = await wfApi.splitAssignGroup(groupId, selectedSplitVehicles);
      if (result?.subGroups) {
        // Replace the original group with the new sub-groups
        setGroups(gs => {
          const filtered = gs.filter(g => g.id !== groupId);
          return [...filtered, ...result.subGroups];
        });
        // Update run total
        if (run) {
          setRun({ ...run, total_groups: (run.total_groups || 0) + result.subGroups.length - 1 });
        }
      }
      setSplitGroupId(null);
      setSelectedSplitVehicles([]);
    } catch { /* shown by hook */ } finally {
      setSplitting(false);
    }
  };

  const toggleSplitVehicle = (vehicleId: number) => {
    setSelectedSplitVehicles(prev =>
      prev.includes(vehicleId) ? prev.filter(id => id !== vehicleId) : [...prev, vehicleId],
    );
  };

  const getDriver = (g: GroupData) => {
    if (g.driver_name) return { name: g.driver_name, phone: g.driver_phone };
    if (!g.assigned_vehicle_id) return null;
    const v = vehicles.find(x => x.id === g.assigned_vehicle_id);
    if (v?.driver_name) return { name: v.driver_name, phone: v.driver_phone };
    return null;
  };

  const assignedCount = groups.filter(g => g.assigned_vehicle_id).length;
  const readyCount = groups.filter(g => g.assigned_vehicle_id && getDriver(g)).length;
  const allReady = groups.length > 0 && readyCount === groups.length;
  const overflowGroups = groups.filter(g => (g.overflow_count ?? 0) > 0).length;
  const progress = groups.length > 0 ? Math.round((readyCount / groups.length) * 100) : 0;

  const totalDistanceKm = groups.reduce((s, g) => s + (Number(g.estimated_distance_km) || 0), 0);
  const totalDurationMin = Math.round(groups.reduce((s, g) => s + (Number(g.estimated_duration_seconds) || 0), 0) / 60);
  const isAmazon = run?.routing_source === 'AMAZON_ROUTE';

  // Determine if a group REQUIRES split — prefer backend truth, fallback to local check
  const groupNeedsSplit = (g: GroupData): boolean => {
    if (g.assigned_vehicle_id) return false;
    if (g.status === 'CONFIRMED') return false;
    // Use backend truth if available
    if (g.requires_split != null) return g.requires_split;
    // Fallback: local check
    const maxEffCap = Math.max(
      ...vehicles.filter(v => v.is_active !== false && v.driver_name).map(v => getEffectiveCapacity(v)),
      0,
    );
    return g.employee_count > maxEffCap;
  };

  // Is the issue a driver/availability problem, not a capacity problem?
  const groupHasDriverProblem = (g: GroupData): boolean => {
    if (g.assigned_vehicle_id) return false;
    if (g.assignment_block_reason === 'no_driver_backed_vehicle') return true;
    // Local fallback: fits any vehicle but no driver-backed vehicle
    if (g.fits_single_vehicle === true && g.requires_split === true) return true;
    return false;
  };

  // Can a group be optionally split? (unconfirmed, 2+ members, not already requiring split)
  const groupCanManualSplit = (g: GroupData): boolean => {
    if (g.assigned_vehicle_id) return false;
    if (g.status === 'CONFIRMED') return false;
    if (g.employee_count < 2) return false;
    return !groupNeedsSplit(g);
  };

  // Is this a split sub-group?
  const isSplitSubGroup = (g: GroupData): boolean => /-V\d+$/.test(g.group_code);

  // Can we unassign? Only confirmed groups before DISPATCHED/CLOSED
  const canUnassign = (g: GroupData): boolean => {
    if (g.status !== 'CONFIRMED') return false;
    const drStatus = run?.daily_run_status;
    return drStatus !== 'DISPATCHED' && drStatus !== 'CLOSED';
  };

  // Can we undo split? Only split sub-groups before DISPATCHED/CLOSED
  const canUndoSplit = (g: GroupData): boolean => {
    if (!isSplitSubGroup(g)) return false;
    const drStatus = run?.daily_run_status;
    return drStatus !== 'DISPATCHED' && drStatus !== 'CLOSED';
  };

  // Calculate total capacity of selected split vehicles
  const selectedSplitCapacity = selectedSplitVehicles.reduce((s, vid) => {
    const v = vehicles.find(x => x.id === vid);
    return s + (v ? getEffectiveCapacity(v) : 0);
  }, 0);

  if (pageLoading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate('/ta/processing')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">Drop-Off Assignment Board</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />{date}
            </span>
            {run && <span>· Run #{run.run_number}</span>}
            {run?.request_count && <span>· {run.request_count} requests</span>}
            {run?.department_count && <span>· {run.department_count} depts</span>}
            <Badge variant={isAmazon ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0">
              {isAmazon ? 'Amazon Routes' : 'Haversine Fallback'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {run && (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate(`/route-map/daily/${date}`)}>
              <Map className="mr-1 h-3.5 w-3.5" /> Map
            </Button>
          )}
          {run && (
            <Badge variant={allReady ? 'default' : 'secondary'}>
              {readyCount}/{groups.length} Ready
            </Badge>
          )}
        </div>
      </div>

      {!run ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Bus className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">No grouping run found</p>
            <p className="text-sm text-muted-foreground">Run grouping from the processing queue first.</p>
            <Button variant="outline" onClick={() => navigate('/ta/processing')}>Back to Queue</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <CapacityWarningBanner unresolvedCount={run.unresolved_count} overflowGroups={overflowGroups} totalGroups={groups.length} />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatMini label="Groups" value={groups.length} icon={<Route className="h-4 w-4 text-primary" />} />
            <StatMini label="Employees" value={run.total_employees} icon={<User className="h-4 w-4 text-primary" />} />
            <StatMini label="Total Distance" value={`${totalDistanceKm.toFixed(1)} km`} icon={<MapPin className="h-4 w-4 text-primary" />} />
            <StatMini label="Total Duration" value={`${totalDurationMin} min`} icon={<Clock className="h-4 w-4 text-primary" />} />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Assignment Progress</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {run.routing_warning && (
            <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))] shrink-0 mt-0.5" />
              <p className="text-xs text-[hsl(var(--warning))]">{run.routing_warning}</p>
            </div>
          )}

          {run.unresolved_count > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{run.unresolved_count} employee(s) excluded — unresolved destinations.</p>
            </div>
          )}

          <div className="space-y-3">
            {groups.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center space-y-2">
                  <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <Route className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-foreground text-sm">No groups in this run</p>
                  <p className="text-xs text-muted-foreground">The grouping run completed but produced no groups. Check if approved requests exist for this date.</p>
                </CardContent>
              </Card>
            )}
            {groups.map(g => {
              const driver = getDriver(g);
              const isReady = !!g.assigned_vehicle_id && !!driver;
              const noDriver = !!g.assigned_vehicle_id && !driver;
              const distKm = g.estimated_distance_km ? Number(g.estimated_distance_km).toFixed(1) : null;
              const durMin = g.estimated_duration_seconds ? Math.round(Number(g.estimated_duration_seconds) / 60) : null;
              const needsSplit = groupNeedsSplit(g);
              const isSplitMode = splitGroupId === g.id;

              return (
                <Card key={g.id} className={`overflow-hidden transition-colors ${isReady ? 'border-primary/20' : noDriver ? 'border-destructive/30' : needsSplit ? 'border-[hsl(var(--warning))]/40' : ''}`}>
                  <CardContent className="p-0">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isReady ? 'bg-primary' : noDriver ? 'bg-destructive' : needsSplit ? 'bg-[hsl(var(--warning))]' : 'bg-muted-foreground/30'}`} />
                        <span className="font-semibold text-sm text-foreground">{g.group_code}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {g.employee_count} emp
                        </Badge>
                        {distKm && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {distKm} km
                          </Badge>
                        )}
                        {durMin !== null && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {durMin} min
                          </Badge>
                        )}
                        {(g.overflow_count ?? 0) > 0 && !needsSplit && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            +{g.overflow_count} overflow (allowed)
                          </Badge>
                        )}
                        {needsSplit && !groupHasDriverProblem(g) && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            Split Required
                          </Badge>
                        )}
                        {groupHasDriverProblem(g) && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            No Driver-Backed Vehicle
                          </Badge>
                        )}
                        {g.routing_source && (
                          <Badge variant={g.routing_source === 'AMAZON_ROUTE' ? 'default' : 'secondary'} className="text-[9px] px-1 py-0">
                            {g.routing_source === 'AMAZON_ROUTE' ? 'Amazon' : 'Haversine'}
                          </Badge>
                        )}
                      </div>
                      {isReady ? (
                        <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                      ) : noDriver ? (
                        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      ) : null}
                    </div>

                    <div className="px-4 py-3 space-y-2.5">
                      {/* Normal single-vehicle assignment (for groups that fit one vehicle) */}
                      {!needsSplit && !isSplitMode && (
                        <div className="flex gap-2 items-start">
                          <Select
                            value={g.assigned_vehicle_id?.toString() || ''}
                            onValueChange={v => handleAssignVehicle(g.id, v)}
                          >
                            <SelectTrigger className="h-9 flex-1">
                              <SelectValue placeholder="Assign vehicle…" />
                            </SelectTrigger>
                            <SelectContent>
                              {vehicles.filter(v => v.is_active !== false).map(v => (
                                <SelectItem key={v.id} value={v.id.toString()}>
                                  <span className="flex items-center gap-2">
                                    {v.type?.toLowerCase().includes('bus') ? (
                                      <Bus className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                      <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                    <span>{v.registration_no}</span>
                                    <span className="text-muted-foreground">· {v.type} · {v.capacity}{getEffectiveCapacity(v) > v.capacity ? `+${getEffectiveCapacity(v) - v.capacity}` : ''} seats</span>
                                    {v.driver_name && <span className="text-muted-foreground text-[10px]">({v.driver_name})</span>}
                                    {!v.driver_name && <AlertTriangle className="h-3 w-3 text-destructive" />}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {groupCanManualSplit(g) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 text-xs gap-1 shrink-0"
                              onClick={() => { setSplitGroupId(g.id); setSelectedSplitVehicles([]); }}
                            >
                              <Scissors className="h-3 w-3" /> Split
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Split required: show split UI */}
                      {needsSplit && !groupHasDriverProblem(g) && !isSplitMode && (
                        <div className="rounded-md border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3 space-y-2">
                          <p className="text-xs text-[hsl(var(--warning))] font-medium flex items-center gap-1.5">
                            <Scissors className="h-3.5 w-3.5" />
                            This group has {g.employee_count} employees and exceeds the capacity of any single vehicle.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1.5"
                            onClick={() => { setSplitGroupId(g.id); setSelectedSplitVehicles([]); }}
                          >
                            <Scissors className="h-3 w-3" /> Split & Assign Multiple Vehicles
                          </Button>
                        </div>
                      )}
                      {/* Driver availability problem */}
                      {groupHasDriverProblem(g) && !isSplitMode && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                          <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            This group fits a vehicle's capacity, but no active vehicle has a permanent driver assigned.
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Assign a permanent driver to a vehicle in Vehicle Management, then return here to assign.
                          </p>
                        </div>
                      )}

                      {/* Split mode: multi-vehicle selection */}
                      {isSplitMode && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
                          <p className="text-xs font-medium text-foreground">
                            {needsSplit ? '⚠ Split required — ' : 'Manual split — '}
                            Select vehicles to split {g.employee_count} employees across:
                          </p>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {vehicles.filter(v => v.is_active !== false && v.driver_name).map(v => (
                              <label key={v.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer text-xs">
                                <Checkbox
                                  checked={selectedSplitVehicles.includes(v.id)}
                                  onCheckedChange={() => toggleSplitVehicle(v.id)}
                                />
                                <span className="flex items-center gap-2 flex-1">
                                  {v.type?.toLowerCase().includes('bus') ? (
                                    <Bus className="h-3.5 w-3.5 text-muted-foreground" />
                                  ) : (
                                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                                  )}
                                  <span className="font-medium">{v.registration_no}</span>
                                  <span className="text-muted-foreground">{v.capacity}{getEffectiveCapacity(v) > v.capacity ? `+${getEffectiveCapacity(v) - v.capacity}` : ''} seats</span>
                                  <span className="text-muted-foreground text-[10px]">({v.driver_name})</span>
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Selected: {selectedSplitVehicles.length} vehicles · {selectedSplitCapacity} total seats
                              {selectedSplitCapacity < g.employee_count && (
                                <span className="text-destructive ml-1">
                                  (need {g.employee_count - selectedSplitCapacity} more seats)
                                </span>
                              )}
                              {selectedSplitCapacity >= g.employee_count && (
                                <span className="text-[hsl(var(--success))] ml-1">✓ Sufficient</span>
                              )}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => { setSplitGroupId(null); setSelectedSplitVehicles([]); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="text-xs gap-1.5"
                              disabled={selectedSplitVehicles.length < 2 || selectedSplitCapacity < g.employee_count || splitting}
                              onClick={() => handleSplitAssign(g.id)}
                            >
                              {splitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                              Split into {selectedSplitVehicles.length} Vehicles
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Auto-derived driver display (read-only) */}
                      {g.assigned_vehicle_id && (
                        <div className="rounded-md bg-muted/50 px-3 py-2">
                          {driver ? (
                            <div className="flex items-center gap-3 text-xs">
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <User className="h-3.5 w-3.5 text-primary" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground truncate">{driver.name}</p>
                                {driver.phone && (
                                  <p className="text-muted-foreground flex items-center gap-1">
                                    <Phone className="h-2.5 w-2.5" />{driver.phone}
                                  </p>
                                )}
                              </div>
                              <Badge variant="outline" className="text-[9px]">Permanent Driver</Badge>
                            </div>
                          ) : (
                            <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3" />
                              No permanent driver — assign one in Vehicle Management first.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Unassign / Undo Split actions */}
                      {canUnassign(g) && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => handleUnassign(g.id)}
                          >
                            <X className="h-3 w-3" /> Unassign Vehicle
                          </Button>
                          {canUndoSplit(g) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1"
                              onClick={() => handleUndoSplit(g.id)}
                            >
                              <Undo2 className="h-3 w-3" /> Undo Split
                            </Button>
                          )}
                        </div>
                      )}
                      {!canUnassign(g) && canUndoSplit(g) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1"
                          onClick={() => handleUndoSplit(g.id)}
                        >
                          <Undo2 className="h-3 w-3" /> Undo Split
                        </Button>
                      )}

                      {g.corridor_label && (
                        <p className="text-[11px] text-muted-foreground">{g.corridor_label}</p>
                      )}
                      {g.cluster_note && (
                        <p className="text-[11px] text-muted-foreground">{g.cluster_note}</p>
                      )}
                    </div>

                    {/* Members collapsible */}
                    {g.members && g.members.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <button className="w-full flex items-center justify-between px-4 py-2 border-t border-border/50 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
                            <span className="flex items-center gap-1.5">
                              <MapPin className="h-3 w-3" />
                              {g.employee_count} drop-off stops
                            </span>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-4 pb-3 space-y-1">
                            {g.members.map((m: any, idx: number) => (
                              <div key={m.employee_id || idx} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded bg-muted/40">
                                <span className="w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center text-[10px] font-mono text-muted-foreground shrink-0">
                                  {m.stop_sequence || idx + 1}
                                </span>
                                <span className="flex-1 truncate text-foreground">
                                  {m.full_name || m.emp_no || `Emp #${m.employee_id}`}
                                </span>
                                {m.depot_distance_km != null && (
                                  <span className="text-muted-foreground text-[10px]">
                                    {Number(m.depot_distance_km).toFixed(1)} km
                                  </span>
                                )}
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  {Number(m.lat_snapshot || 0).toFixed(4)}, {Number(m.lng_snapshot || 0).toFixed(4)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Submit bar */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border -mx-4 px-4 py-3 flex items-center gap-3">
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate('/ta/processing')}>
              Back
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              disabled={!allReady || submitting || submitted}
              onClick={async () => {
                if (!date) return;
                setSubmitting(true);
                try {
                  await wfApi.submitDailyToHr(date);
                  setSubmitted(true);
                } catch { /* shown by hook */ } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> :
               submitted ? <CheckCircle className="mr-1.5 h-3.5 w-3.5" /> :
               <Send className="mr-1.5 h-3.5 w-3.5" />}
              {submitted ? 'Submitted to HR' : 'Submit to HR'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StatMini({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-center">
      {icon && <div className="flex justify-center mb-1">{icon}</div>}
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
