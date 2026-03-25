import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  RouteGroupRun, GeneratedRouteGroup, GeneratedRouteGroupMember,
  AssignmentException, GroupVehicleAssignment, GroupingAuditLog, RouteSegmentSplit, TripManifest,
} from './entities';
import { TransportRequestEmployee, TransportRequest } from '../transport-requests/transport-request.entity';
import { Employee } from '../employees/employee.entity';
import { Place } from '../places/place.entity';
import { Vehicle } from '../vehicles/vehicle.entity';
import { Driver } from '../drivers/driver.entity';
import { RouteCorridor } from '../routes/route.entity';
import {
  GroupStatus, VehicleType, SourceType, ExceptionSeverity, ExceptionStatus,
  SplitStrategy, GroupingAuditAction, RequestStatus,
} from '../../common/enums';
import { RunGroupingDto, RegenerateDto, AutoSplitDto } from './dto/grouping.dto';
import { LocationService } from '../location/location.service';

/* ─── Internal types ─── */

interface ResolvedEmployee {
  employeeId: number;
  empNo?: string;
  fullName: string;
  placeId?: number;
  lat: number;
  lng: number;
  sourceType: SourceType;
  bearing: number;
  distanceFromDepot: number;
  corridorId?: number;
  corridorLabel?: string;
  otTime?: string;
}

interface CorridorMatch {
  corridorId?: number;
  corridorLabel: string;
  matchReason: string;
}

interface RouteSegment {
  corridorId?: number;
  corridorLabel: string;
  employees: ResolvedEmployee[];
  timeSlot?: string;
  segmentLabel?: string;
  segmentOrder: number;
  splitInfo?: {
    strategy: SplitStrategy;
    segmentOrder: number;
    boundaryKm: number;
    reasoning: string;
  };
}

interface VehicleRecommendation {
  vehicleId?: number;
  vehicleType: string;
  overflowNeeded: boolean;
  overflowCount: number;
  capacityWarning: boolean;
  reason: string;
}

interface CorridorBudget {
  corridorLabel: string;
  corridorId?: number;
  totalEmployees: number;
  chain: ResolvedEmployee[];
  idealVehicleCount: number;
  vehicleType: string;
  segments: ResolvedEmployee[][];
  reasoning: string;
}

@Injectable()
export class GroupingService {
  private readonly logger = new Logger(GroupingService.name);
  private depotLat: number;
  private depotLng: number;

  constructor(
    @InjectRepository(RouteGroupRun) private runRepo: Repository<RouteGroupRun>,
    @InjectRepository(GeneratedRouteGroup) private groupRepo: Repository<GeneratedRouteGroup>,
    @InjectRepository(GeneratedRouteGroupMember) private memberRepo: Repository<GeneratedRouteGroupMember>,
    @InjectRepository(AssignmentException) private exceptionRepo: Repository<AssignmentException>,
    @InjectRepository(GroupVehicleAssignment) private assignmentRepo: Repository<GroupVehicleAssignment>,
    @InjectRepository(GroupingAuditLog) private auditLogRepo: Repository<GroupingAuditLog>,
    @InjectRepository(RouteSegmentSplit) private splitRepo: Repository<RouteSegmentSplit>,
    @InjectRepository(TripManifest) private manifestRepo: Repository<TripManifest>,
    @InjectRepository(TransportRequestEmployee) private reqEmpRepo: Repository<TransportRequestEmployee>,
    @InjectRepository(TransportRequest) private reqRepo: Repository<TransportRequest>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    @InjectRepository(Place) private placeRepo: Repository<Place>,
    @InjectRepository(Vehicle) private vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Driver) private driverRepo: Repository<Driver>,
    @InjectRepository(RouteCorridor) private corridorRepo: Repository<RouteCorridor>,
    private config: ConfigService,
    private dataSource: DataSource,
    private locationService: LocationService,
  ) {
    this.depotLat = this.config.get<number>('depot.lat', 6.0477241);
    this.depotLng = this.config.get<number>('depot.lng', 80.2479661);
  }

  /* ═══════════════════════════════════════════════
     RUN GROUPING — main entry point
     New algorithm: corridor → ordered chain → vehicle budget → contiguous partition → consolidation
     ═══════════════════════════════════════════════ */

  async runGrouping(requestId: number, userId: number, params?: RunGroupingDto): Promise<RouteGroupRun & { groups: any[]; exceptions: any[] }> {
    const sectorAngle = params?.sectorAngle ?? 30;
    const maxChainGap = params?.maxClusterRadiusKm ?? 8; // max gap between consecutive stops in chain
    const timeWindowMin = params?.timeWindowMinutes ?? 60;
    const dropOffOrder = params?.dropOffOrder ?? 'FARTHEST_FIRST';
    const crossCorridorMerge = params?.crossCorridorMerge ?? false;
    const autoSplit = params?.autoSplitEnabled ?? true;

    const vanCap = this.config.get<number>('vehicle.vanCapacity', 15);
    const busCap = this.config.get<number>('vehicle.busCapacity', 52);
    const vanOverflow = this.config.get<number>('vehicle.vanSoftOverflow', 2);
    const busOverflow = this.config.get<number>('vehicle.busSoftOverflow', 10);
    const minVanOccupancy = this.config.get<number>('vehicle.minVanOccupancy', 5);
    const minBusOccupancy = this.config.get<number>('vehicle.minBusOccupancy', 15);

    // Validate request
    const request = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Transport request #${requestId} not found`);

    if (![RequestStatus.DAILY_LOCKED, RequestStatus.TA_PROCESSING, RequestStatus.GROUPED, RequestStatus.GROUPING_COMPLETED, RequestStatus.TA_COMPLETED].includes(request.status as any)) {
      throw new BadRequestException('Daily run must be locked before Transport Authority can run grouping');
    }

    const scopeRequests = await this.getDailyRunScopeRequests(request);
    const scopeRequestIds = scopeRequests.map(r => r.id);
    if (!scopeRequestIds.length) throw new BadRequestException('No locked daily-run requests found for this date');

    // 1. Fetch employees across the entire locked day run (all departments for the same date)
    const reqEmps = await this.reqEmpRepo.find({ where: { request_id: In(scopeRequestIds) } });
    if (!reqEmps.length) throw new BadRequestException('No employees in this daily run');

    const employeeIds = Array.from(new Set(reqEmps.map(re => re.employee_id)));
    const employees = await this.empRepo.findByIds(employeeIds);
    const employeeMap = new Map(employees.map(emp => [emp.id, emp]));
    const requestTimeMap = new Map(scopeRequests.map(r => [r.id, r.ot_time || undefined]));

    // 2. Load configured corridors
    const corridors = await this.corridorRepo.find({ where: { is_active: true } });

    // 3. Resolve destinations
    const resolved: ResolvedEmployee[] = [];
    const unresolvedExceptions: Partial<AssignmentException>[] = [];
    const seenIds = new Set<number>();

    for (const reqEmp of reqEmps) {
      const emp = employeeMap.get(reqEmp.employee_id);
      if (!emp) continue;

      // Duplicate check across the whole locked daily run
      if (seenIds.has(emp.id)) {
        unresolvedExceptions.push({
          employee_id: emp.id,
          exception_type: 'DUPLICATE_EMPLOYEE',
          description: `Employee ${emp.full_name} (${emp.emp_no || emp.id}) appears multiple times in the locked daily run`,
          severity: ExceptionSeverity.LOW,
        });
        continue;
      }
      seenIds.add(emp.id);

      if (!emp.is_active) {
        unresolvedExceptions.push({
          employee_id: emp.id,
          exception_type: 'INACTIVE_EMPLOYEE',
          description: `Employee ${emp.full_name} (${emp.emp_no || emp.id}) is inactive`,
          severity: ExceptionSeverity.MEDIUM,
        });
        continue;
      }

      const resolution = await this.resolveDestination(emp);
      if (!resolution) {
        unresolvedExceptions.push({
          employee_id: emp.id,
          exception_type: 'UNRESOLVED_LOCATION',
          description: `Employee ${emp.full_name} (${emp.emp_no || emp.id}) has no resolvable destination coordinates`,
          severity: ExceptionSeverity.HIGH,
        });
        continue;
      }

      const bearing = this.calculateBearing(this.depotLat, this.depotLng, resolution.lat, resolution.lng);
      const distance = this.haversineDistance(this.depotLat, this.depotLng, resolution.lat, resolution.lng);
      const corridor = this.matchCorridor(bearing, corridors, sectorAngle);

      resolved.push({
        employeeId: emp.id,
        empNo: emp.emp_no,
        fullName: emp.full_name,
        placeId: resolution.placeId,
        lat: resolution.lat,
        lng: resolution.lng,
        sourceType: resolution.sourceType,
        bearing,
        distanceFromDepot: distance,
        corridorId: corridor.corridorId,
        corridorLabel: corridor.corridorLabel,
        otTime: requestTimeMap.get(reqEmp.request_id),
      });
    }

    // 4. Group by corridor
    const corridorGroups = new Map<string, ResolvedEmployee[]>();
    for (const emp of resolved) {
      const key = emp.corridorLabel ?? 'UNKNOWN';
      if (!corridorGroups.has(key)) corridorGroups.set(key, []);
      corridorGroups.get(key)!.push(emp);
    }

    // 5. ENFORCE TIME WINDOW: split corridor groups by OT time slots
    const timeAwareCorridors = this.enforceTimeWindows(corridorGroups, timeWindowMin);

    // 6. NEW ALGORITHM: For each corridor+time bucket:
    //    a) Build ordered route chain (nearest-neighbor, not anchor clustering)
    //    b) Plan vehicle budget
    //    c) Partition chain into contiguous segments
    const vehicles = await this.vehicleRepo.find({ where: { is_active: true }, order: { capacity: 'ASC' } });

    const corridorBudgets: CorridorBudget[] = [];
    for (const [key, emps] of timeAwareCorridors) {
      const chain = this.buildOrderedRouteChain(emps, maxChainGap);
      const budget = this.planVehicleBudget(chain, key, emps[0]?.corridorId, vanCap, busCap, vanOverflow, busOverflow);
      corridorBudgets.push(budget);
    }

    // 7. CROSS-CORRIDOR MERGE: if enabled, merge underfilled corridors with compatible bearings
    let finalBudgets = corridorBudgets;
    if (crossCorridorMerge) {
      finalBudgets = this.crossCorridorConsolidate(corridorBudgets, vanCap, minVanOccupancy);
    }

    // 8. CONSOLIDATION PASS: merge underfilled adjacent segments within corridors
    const allSegments: RouteSegment[] = [];
    for (const budget of finalBudgets) {
      const consolidated = this.consolidateSegments(budget, vanCap, busCap, minVanOccupancy, minBusOccupancy);
      allSegments.push(...consolidated);
    }

    // 9. Create run record
    const lastRun = await this.runRepo.findOne({ where: { request_id: requestId }, order: { run_number: 'DESC' } });
    const runNumber = (lastRun?.run_number || 0) + 1;

    // Quality warnings
    const avgOccupancy = allSegments.length > 0
      ? allSegments.reduce((s, seg) => s + seg.employees.length, 0) / allSegments.length
      : 0;
    const warnings: string[] = [];
    if (allSegments.length > 0 && avgOccupancy < minVanOccupancy) {
      warnings.push(`Low avg occupancy: ${avgOccupancy.toFixed(1)} per group`);
    }
    if (resolved.length > 0 && allSegments.length > resolved.length / 3) {
      warnings.push(`High group count (${allSegments.length}) for ${resolved.length} employees — review for efficiency`);
    }

    const summary = [
      `Run #${runNumber}: ${allSegments.length} groups for ${resolved.length} employees across ${scopeRequests.length} request(s) on ${this.getRequestDateString(request.request_date)}.`,
      `${unresolvedExceptions.length} unresolved.`,
      `Avg occupancy: ${avgOccupancy.toFixed(1)}.`,
      ...warnings,
    ].join(' ');

    // Track routing availability for run-level warning
    const routingAvailable = this.locationService.isRoutingAvailable();
    let routingWarning: string | undefined;
    if (!routingAvailable) {
      routingWarning = 'Amazon Location Service not configured — using haversine distance fallback';
    }

    const run = await this.runRepo.save(this.runRepo.create({
      request_id: requestId,
      run_number: runNumber,
      initiated_by_user_id: userId,
      parameters: { sectorAngle, maxChainGap, timeWindowMin, dropOffOrder, crossCorridorMerge, autoSplit, scopeRequestIds, requestDate: this.getRequestDateString(request.request_date) },
      total_groups: allSegments.length,
      total_employees: resolved.length,
      unresolved_count: unresolvedExceptions.length,
      summary,
      routing_warning: routingWarning,
    }));

    // Save exceptions
    const savedExceptions: AssignmentException[] = [];
    for (const exc of unresolvedExceptions) {
      const saved = await this.exceptionRepo.save(this.exceptionRepo.create({ ...exc, run_id: run.id }));
      savedExceptions.push(saved);
    }

    // 10. Save groups, members, splits
    const savedGroups: any[] = [];
    let groupIndex = 0;

    for (const segment of allSegments) {
      groupIndex++;
      const centerLat = segment.employees.reduce((s, e) => s + e.lat, 0) / segment.employees.length;
      const centerLng = segment.employees.reduce((s, e) => s + e.lng, 0) / segment.employees.length;
      const maxDist = Math.max(...segment.employees.map(e => e.distanceFromDepot));
      const avgBearing = segment.employees.reduce((s, e) => s + e.bearing, 0) / segment.employees.length;

      const rec = this.recommendVehicle(segment.employees.length, vehicles, vanCap, busCap, vanOverflow, busOverflow);

      const group = await this.groupRepo.save(this.groupRepo.create({
        run_id: run.id,
        request_id: requestId,
        group_code: `G${runNumber}-${String(groupIndex).padStart(3, '0')}`,
        corridor_id: segment.corridorId,
        corridor_label: segment.corridorLabel,
        parent_route_segment: segment.segmentLabel,
        center_lat: centerLat,
        center_lng: centerLng,
        employee_count: segment.employees.length,
        status: rec.capacityWarning ? GroupStatus.REVIEW_REQUIRED : GroupStatus.PENDING,
        recommended_vehicle_type: rec.vehicleType,
        recommended_vehicle_id: rec.vehicleId ?? undefined,
        overflow_allowed: rec.overflowNeeded,
        overflow_count: rec.overflowCount,
        capacity_warning: rec.capacityWarning,
        recommendation_reason: rec.reason,
        cluster_note: `${segment.corridorLabel}${segment.segmentLabel ? ` / ${segment.segmentLabel}` : ''} — ${segment.employees.length} employees`,
        bearing_from_depot: avgBearing,
        max_distance_km: maxDist,
        time_slot: segment.timeSlot,
        routing_source: routingAvailable ? 'AMAZON_LOCATION' : 'HAVERSINE_FALLBACK',
      }));

      // Generate drop-off stop sequence
      const ordered = this.generateDropOffOrder(segment.employees, dropOffOrder);

      const members: any[] = [];
      for (let seq = 0; seq < ordered.length; seq++) {
        const emp = ordered[seq];
        const prevEmp = seq > 0 ? ordered[seq - 1] : null;
        const legDist = prevEmp
          ? this.haversineDistance(prevEmp.lat, prevEmp.lng, emp.lat, emp.lng)
          : this.haversineDistance(this.depotLat, this.depotLng, emp.lat, emp.lng);

        const member = await this.memberRepo.save(this.memberRepo.create({
          generated_group_id: group.id,
          employee_id: emp.employeeId,
          place_id: emp.placeId ?? undefined,
          lat_snapshot: emp.lat,
          lng_snapshot: emp.lng,
          stop_sequence: seq + 1,
          source_type: emp.sourceType,
          bearing_from_depot: emp.bearing,
          distance_from_depot_km: emp.distanceFromDepot,
          leg_distance_km: Math.round(legDist * 100) / 100,
        }));
        members.push(member);
      }

      // Calculate route geometry via Amazon Location (async, non-blocking for group save)
      try {
        const stops = ordered.map(e => ({ lat: e.lat, lng: e.lng }));
        const routeResult = await this.locationService.calculateGroupRoute(
          { lat: this.depotLat, lng: this.depotLng },
          stops,
        );
        if (routeResult) {
          await this.groupRepo.update(group.id, {
            route_geometry: routeResult.geometry,
            estimated_distance_km: routeResult.distance_km,
            estimated_duration_seconds: routeResult.duration_seconds,
            routing_source: 'AMAZON_LOCATION',
          });
          group.route_geometry = routeResult.geometry;
          group.estimated_distance_km = routeResult.distance_km;
          group.estimated_duration_seconds = routeResult.duration_seconds;
        }
      } catch (routeErr) {
        this.logger.warn(`Route calculation failed for group ${group.group_code}: ${routeErr.message}`);
        if (!routingWarning) {
          routingWarning = 'Some route calculations failed — partial haversine fallback used';
          await this.runRepo.update(run.id, { routing_warning: routingWarning });
        }
      }

      // Save split record if multi-vehicle corridor
      if (segment.splitInfo) {
        await this.splitRepo.save(this.splitRepo.create({
          run_id: run.id,
          corridor_id: segment.corridorId,
          parent_group_id: undefined,
          split_strategy: segment.splitInfo.strategy,
          boundary_type: 'DISTANCE_KM',
          boundary_value: String(segment.splitInfo.boundaryKm),
          segment_code: segment.segmentLabel || `Segment-${groupIndex}`,
          segment_order: segment.splitInfo.segmentOrder,
          reasoning: segment.splitInfo.reasoning,
        }));
      }

      savedGroups.push({ ...group, members });
    }

    // Audit log
    await this.auditLogRepo.save(this.auditLogRepo.create({
      run_id: run.id,
      action_type: GroupingAuditAction.RUN_GROUPING,
      after_payload: {
        totalGroups: allSegments.length,
        totalEmployees: resolved.length,
        unresolvedCount: unresolvedExceptions.length,
        avgOccupancy: Math.round(avgOccupancy * 10) / 10,
        warnings,
      },
      changed_by_user_id: userId,
    }));

    // Update all request statuses for the locked day run
    await this.reqRepo.createQueryBuilder()
      .update(TransportRequest)
      .set({ status: RequestStatus.GROUPED })
      .where('id IN (:...ids)', { ids: scopeRequestIds })
      .andWhere('status IN (:...statuses)', { statuses: [RequestStatus.DAILY_LOCKED, RequestStatus.TA_PROCESSING, RequestStatus.GROUPING_COMPLETED] })
      .execute();

    return { ...run, groups: savedGroups, exceptions: savedExceptions };
  }


  private async getDailyRunScopeRequests(anchor: TransportRequest): Promise<TransportRequest[]> {
    const requestDate = this.getRequestDateString(anchor.request_date);
    return this.reqRepo.find({
      where: {
        request_date: requestDate as any,
        status: In([
          RequestStatus.DAILY_LOCKED,
          RequestStatus.TA_PROCESSING,
          RequestStatus.GROUPED,
          RequestStatus.GROUPING_COMPLETED,
          RequestStatus.TA_COMPLETED,
        ]),
      },
      order: { department_id: 'ASC', id: 'ASC' },
    });
  }

  private getRequestDateString(value: string | Date): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
  }

  /* ═══════════════════════════════════════════════
     NEW: ENFORCE TIME WINDOWS
     Split corridor groups by OT time if timeWindowMinutes exceeded
     ═══════════════════════════════════════════════ */

  private enforceTimeWindows(
    corridorGroups: Map<string, ResolvedEmployee[]>,
    timeWindowMin: number,
  ): Map<string, ResolvedEmployee[]> {
    if (timeWindowMin <= 0) return corridorGroups;
    // If all employees share the same otTime (common case), no splitting needed
    // For real enforcement we'd parse otTime, but many requests have a single OT time
    // This handles the case where employees have different times
    const result = new Map<string, ResolvedEmployee[]>();

    for (const [key, emps] of corridorGroups) {
      // Parse OT times and bucket
      const timeBuckets = new Map<string, ResolvedEmployee[]>();
      for (const emp of emps) {
        const bucket = this.getTimeBucket(emp.otTime, timeWindowMin);
        if (!timeBuckets.has(bucket)) timeBuckets.set(bucket, []);
        timeBuckets.get(bucket)!.push(emp);
      }

      if (timeBuckets.size <= 1) {
        result.set(key, emps);
      } else {
        // Multiple time slots — split into separate corridor+time groups
        for (const [slot, slotEmps] of timeBuckets) {
          result.set(`${key} [${slot}]`, slotEmps);
        }
      }
    }

    return result;
  }

  private getTimeBucket(otTime: string | undefined, windowMin: number): string {
    if (!otTime) return 'default';
    // Try to parse HH:mm or HH:mm:ss
    const match = otTime.match(/(\d{1,2}):(\d{2})/);
    if (!match) return 'default';
    const totalMinutes = parseInt(match[1]) * 60 + parseInt(match[2]);
    const bucketIndex = Math.floor(totalMinutes / windowMin);
    const bucketStart = bucketIndex * windowMin;
    const h = Math.floor(bucketStart / 60);
    const m = bucketStart % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /* ═══════════════════════════════════════════════
     NEW: BUILD ORDERED ROUTE CHAIN
     Uses nearest-neighbor heuristic from depot outward
     instead of anchor-based radius clustering
     ═══════════════════════════════════════════════ */

  private buildOrderedRouteChain(employees: ResolvedEmployee[], maxGapKm: number): ResolvedEmployee[] {
    if (employees.length <= 1) return [...employees];

    // Sort by distance from depot as baseline, then refine with nearest-neighbor
    const sorted = [...employees].sort((a, b) => a.distanceFromDepot - b.distanceFromDepot);

    // Nearest-neighbor chain starting from nearest to depot
    const chain: ResolvedEmployee[] = [];
    const remaining = new Set(sorted.map((_, i) => i));
    let currentIdx = 0; // start with nearest to depot
    chain.push(sorted[currentIdx]);
    remaining.delete(currentIdx);

    while (remaining.size > 0) {
      const current = sorted[currentIdx];
      let bestIdx = -1;
      let bestDist = Infinity;

      for (const idx of remaining) {
        const dist = this.haversineDistance(current.lat, current.lng, sorted[idx].lat, sorted[idx].lng);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }

      if (bestIdx >= 0) {
        chain.push(sorted[bestIdx]);
        remaining.delete(bestIdx);
        currentIdx = bestIdx;
      }
    }

    return chain;
  }

  /* ═══════════════════════════════════════════════
     NEW: PLAN VEHICLE BUDGET PER CORRIDOR
     Determines ideal number of vehicles BEFORE creating groups
     ═══════════════════════════════════════════════ */

  private planVehicleBudget(
    chain: ResolvedEmployee[],
    corridorLabel: string,
    corridorId: number | undefined,
    vanCap: number,
    busCap: number,
    vanOverflow: number,
    busOverflow: number,
  ): CorridorBudget {
    const n = chain.length;
    if (n === 0) {
      return { corridorLabel, corridorId, totalEmployees: 0, chain, idealVehicleCount: 0, vehicleType: 'VAN', segments: [], reasoning: 'Empty corridor' };
    }

    // Determine best vehicle strategy: all vans, all buses, or mixed
    const vansNeeded = Math.ceil(n / vanCap);
    const busesNeeded = Math.ceil(n / busCap);

    // Cost model: prefer fewer vehicles. 1 bus ~ 1.5 van cost, but 1 bus replaces 3-4 vans
    // Decision: if bus count < van count by at least 2, prefer buses
    let vehicleType: string;
    let idealCount: number;
    let reasoning: string;

    if (n <= vanCap + vanOverflow) {
      // Single van fits
      vehicleType = 'VAN';
      idealCount = 1;
      reasoning = `${n} employees fit in 1 van (cap ${vanCap}+${vanOverflow})`;
    } else if (n <= busCap + busOverflow && busesNeeded === 1) {
      // Single bus is more efficient than multiple vans
      if (vansNeeded >= 2) {
        vehicleType = 'BUS';
        idealCount = 1;
        reasoning = `${n} employees: 1 bus (cap ${busCap}) more efficient than ${vansNeeded} vans`;
      } else {
        vehicleType = 'VAN';
        idealCount = vansNeeded;
        reasoning = `${n} employees in ${vansNeeded} van(s)`;
      }
    } else {
      // Multiple vehicles needed
      // Compare total cost: buses vs vans
      // Prefer option with fewer total vehicles and better occupancy
      const busOption = busesNeeded;
      const vanOption = vansNeeded;

      if (busOption < vanOption && n > vanCap * 2) {
        vehicleType = 'BUS';
        idealCount = busOption;
        reasoning = `${n} employees: ${busOption} bus(es) more efficient than ${vanOption} vans`;
      } else {
        vehicleType = 'VAN';
        idealCount = vanOption;
        reasoning = `${n} employees split into ${vanOption} van-sized route segments`;
      }
    }

    // Partition chain into segments
    const segmentSize = vehicleType === 'BUS' ? busCap : vanCap;
    const segments = this.partitionChainContiguous(chain, segmentSize, idealCount);

    return {
      corridorLabel,
      corridorId,
      totalEmployees: n,
      chain,
      idealVehicleCount: idealCount,
      vehicleType,
      segments,
      reasoning,
    };
  }

  /* ═══════════════════════════════════════════════
     NEW: PARTITION CHAIN INTO CONTIGUOUS SEGMENTS
     Splits ordered chain into N roughly-equal contiguous parts
     ═══════════════════════════════════════════════ */

  private partitionChainContiguous(chain: ResolvedEmployee[], maxPerSegment: number, targetSegments: number): ResolvedEmployee[][] {
    const n = chain.length;
    if (n === 0) return [];
    if (n <= maxPerSegment && targetSegments <= 1) return [chain];

    const actualSegments = Math.max(targetSegments, Math.ceil(n / maxPerSegment));
    const baseSize = Math.floor(n / actualSegments);
    const remainder = n % actualSegments;

    const segments: ResolvedEmployee[][] = [];
    let offset = 0;
    for (let i = 0; i < actualSegments; i++) {
      const size = baseSize + (i < remainder ? 1 : 0);
      segments.push(chain.slice(offset, offset + size));
      offset += size;
    }

    return segments.filter(s => s.length > 0);
  }

  /* ═══════════════════════════════════════════════
     NEW: CROSS-CORRIDOR CONSOLIDATION
     Merges underfilled corridors with compatible bearings
     ═══════════════════════════════════════════════ */

  private crossCorridorConsolidate(
    budgets: CorridorBudget[],
    vanCap: number,
    minOccupancy: number,
  ): CorridorBudget[] {
    const result: CorridorBudget[] = [];
    const underfilled: CorridorBudget[] = [];
    const adequate: CorridorBudget[] = [];

    for (const b of budgets) {
      if (b.totalEmployees < minOccupancy && b.totalEmployees > 0) {
        underfilled.push(b);
      } else {
        adequate.push(b);
      }
    }

    result.push(...adequate);

    // Try merging underfilled corridors with compatible bearings
    const merged = new Set<number>();
    for (let i = 0; i < underfilled.length; i++) {
      if (merged.has(i)) continue;
      let current = underfilled[i];

      for (let j = i + 1; j < underfilled.length; j++) {
        if (merged.has(j)) continue;
        const other = underfilled[j];

        // Check bearing compatibility (within 60 degrees)
        const avgBearingA = current.chain.length > 0 ? current.chain.reduce((s, e) => s + e.bearing, 0) / current.chain.length : 0;
        const avgBearingB = other.chain.length > 0 ? other.chain.reduce((s, e) => s + e.bearing, 0) / other.chain.length : 0;
        const bearingDiff = Math.abs(avgBearingA - avgBearingB);
        const normalizedDiff = Math.min(bearingDiff, 360 - bearingDiff);

        if (normalizedDiff <= 60 && current.totalEmployees + other.totalEmployees <= vanCap) {
          // Merge
          const mergedChain = [...current.chain, ...other.chain].sort((a, b) => a.distanceFromDepot - b.distanceFromDepot);
          current = {
            corridorLabel: `${current.corridorLabel} + ${other.corridorLabel}`,
            corridorId: current.corridorId,
            totalEmployees: current.totalEmployees + other.totalEmployees,
            chain: mergedChain,
            idealVehicleCount: 1,
            vehicleType: 'VAN',
            segments: [mergedChain],
            reasoning: `Cross-corridor merge: ${current.corridorLabel} + ${other.corridorLabel} (bearing diff ${normalizedDiff.toFixed(0)}°)`,
          };
          merged.add(j);
        }
      }
      result.push(current);
    }

    return result;
  }

  /* ═══════════════════════════════════════════════
     NEW: CONSOLIDATION PASS
     Merges underfilled adjacent segments within a corridor
     ═══════════════════════════════════════════════ */

  private consolidateSegments(
    budget: CorridorBudget,
    vanCap: number,
    busCap: number,
    minVanOccupancy: number,
    minBusOccupancy: number,
  ): RouteSegment[] {
    const { segments, corridorLabel, corridorId } = budget;
    if (segments.length === 0) return [];

    // Merge adjacent underfilled segments
    const consolidated: ResolvedEmployee[][] = [];
    let current = [...segments[0]];

    for (let i = 1; i < segments.length; i++) {
      const next = segments[i];
      const combined = current.length + next.length;

      // If current is underfilled AND merging doesn't exceed capacity, merge
      const cap = budget.vehicleType === 'BUS' ? busCap : vanCap;
      const minOcc = budget.vehicleType === 'BUS' ? minBusOccupancy : minVanOccupancy;

      if (current.length < minOcc && combined <= cap) {
        current = [...current, ...next];
      } else {
        consolidated.push(current);
        current = [...next];
      }
    }
    consolidated.push(current);

    // Convert to RouteSegment objects
    const isMultiSegment = consolidated.length > 1;
    return consolidated.map((emps, idx) => {
      const segLabel = isMultiSegment ? `${corridorLabel}-Seg${idx + 1}` : undefined;
      const maxDist = emps.length > 0 ? Math.max(...emps.map(e => e.distanceFromDepot)) : 0;

      return {
        corridorId,
        corridorLabel,
        employees: emps,
        timeSlot: emps[0]?.otTime,
        segmentLabel: segLabel,
        segmentOrder: idx + 1,
        splitInfo: isMultiSegment ? {
          strategy: SplitStrategy.STOP_SEQUENCE_PARTITION,
          segmentOrder: idx + 1,
          boundaryKm: maxDist,
          reasoning: budget.reasoning,
        } : undefined,
      };
    });
  }

  /* ═══════════════════════════════════════════════
     GET LATEST RUN
     ═══════════════════════════════════════════════ */

  async getLatestRun(requestId: number): Promise<any> {
    const run = await this.runRepo.findOne({ where: { request_id: requestId }, order: { run_number: 'DESC' } });
    if (!run) throw new NotFoundException('No grouping runs found for this request');
    return this.getRunDetails(run);
  }

  async getRunDetails(run: RouteGroupRun): Promise<any> {
    const groups = await this.groupRepo.find({ where: { run_id: run.id }, order: { group_code: 'ASC' } });
    const exceptions = await this.exceptionRepo.find({ where: { run_id: run.id }, order: { created_at: 'ASC' } });
    const splits = await this.splitRepo.find({ where: { run_id: run.id }, order: { segment_order: 'ASC' } });

    const groupsWithMembers = [];
    for (const g of groups) {
      const members = await this.memberRepo.find({
        where: { generated_group_id: g.id },
        order: { stop_sequence: 'ASC' },
      });

      const enrichedMembers = [];
      for (const m of members) {
        const emp = await this.empRepo.findOne({ where: { id: m.employee_id } });
        enrichedMembers.push({
          ...m,
          emp_no: emp?.emp_no,
          full_name: emp?.full_name,
          phone: emp?.phone,
          department_id: emp?.department_id,
        });
      }

      let vehicleInfo: any = null;
      let driverInfo: any = null;
      if (g.assigned_vehicle_id) {
        const v = await this.vehicleRepo.findOne({ where: { id: g.assigned_vehicle_id } });
        if (v) vehicleInfo = { id: v.id, registration_no: v.registration_no, type: v.type, capacity: v.capacity };
      }
      if (g.assigned_driver_id) {
        const d = await this.driverRepo.findOne({ where: { id: g.assigned_driver_id } });
        if (d) driverInfo = { id: d.id, full_name: d.full_name, phone: d.phone };
      }

      groupsWithMembers.push({ ...g, members: enrichedMembers, vehicle: vehicleInfo, driver: driverInfo });
    }

    return { ...run, groups: groupsWithMembers, exceptions, splits };
  }

  /* ═══════════════════════════════════════════════
     REGENERATE
     ═══════════════════════════════════════════════ */

  async regenerate(runId: number, userId: number, params?: RegenerateDto): Promise<any> {
    const oldRun = await this.runRepo.findOne({ where: { id: runId } });
    if (!oldRun) throw new NotFoundException('Run not found');

    const lockedGroups = await this.groupRepo.find({ where: { run_id: runId, locked: true } });

    await this.auditLogRepo.save(this.auditLogRepo.create({
      run_id: runId,
      action_type: GroupingAuditAction.REGENERATE,
      before_payload: { run_id: runId, locked_groups: lockedGroups.map(g => g.id) },
      changed_by_user_id: userId,
    }));

    const result = await this.runGrouping(oldRun.request_id, userId, {
      sectorAngle: params?.sectorAngle,
      maxClusterRadiusKm: params?.maxClusterRadiusKm,
      timeWindowMinutes: params?.timeWindowMinutes,
      dropOffOrder: params?.dropOffOrder,
    });

    // Restore locked groups from previous run
    if (lockedGroups.length > 0) {
      for (const locked of lockedGroups) {
        const members = await this.memberRepo.find({ where: { generated_group_id: locked.id } });
        const newGroup = await this.groupRepo.save(this.groupRepo.create({
          ...locked,
          id: undefined as any,
          run_id: result.id,
          group_code: `${locked.group_code}-L`,
          created_at: undefined as any,
        }));

        for (const m of members) {
          await this.memberRepo.save(this.memberRepo.create({
            ...m,
            id: undefined as any,
            generated_group_id: newGroup.id,
            created_at: undefined as any,
          }));
        }
      }

      const allGroups = await this.groupRepo.find({ where: { run_id: result.id } });
      await this.runRepo.update(result.id, {
        total_groups: allGroups.length,
        summary: `${result.summary} (${lockedGroups.length} locked groups preserved)`,
      });
    }

    return this.getLatestRun(oldRun.request_id);
  }

  /* ═══════════════════════════════════════════════
     ASSIGN VEHICLE
     ═══════════════════════════════════════════════ */

  async assignVehicle(groupId: number, vehicleId: number, userId?: number): Promise<GeneratedRouteGroup> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const vehicle = await this.vehicleRepo.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const before = { assigned_vehicle_id: group.assigned_vehicle_id };
    const capacityWarning = group.employee_count > vehicle.capacity;
    const overflowCount = Math.max(0, group.employee_count - vehicle.capacity);
    const overflowAllowed = overflowCount > 0 && overflowCount <= vehicle.soft_overflow;

    await this.groupRepo.update(groupId, {
      assigned_vehicle_id: vehicleId,
      recommended_vehicle_type: vehicle.type,
      overflow_allowed: overflowAllowed,
      overflow_count: overflowCount,
      capacity_warning: capacityWarning && !overflowAllowed,
      status: group.status === GroupStatus.PENDING ? GroupStatus.CONFIRMED : group.status,
    });

    await this.assignmentRepo.save(this.assignmentRepo.create({
      group_id: groupId,
      vehicle_id: vehicleId,
      driver_id: group.assigned_driver_id,
      assigned_by_user_id: userId,
    }));

    if (userId) {
      await this.auditLogRepo.save(this.auditLogRepo.create({
        run_id: group.run_id,
        group_id: groupId,
        action_type: GroupingAuditAction.ASSIGN_VEHICLE,
        before_payload: before,
        after_payload: { assigned_vehicle_id: vehicleId, vehicle_reg: vehicle.registration_no },
        changed_by_user_id: userId,
      }));
    }

    return this.groupRepo.findOneOrFail({ where: { id: groupId } });
  }

  /* ═══════════════════════════════════════════════
     ASSIGN DRIVER
     ═══════════════════════════════════════════════ */

  async assignDriver(groupId: number, driverId: number, userId?: number): Promise<GeneratedRouteGroup> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const driver = await this.driverRepo.findOne({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const before = { assigned_driver_id: group.assigned_driver_id };
    await this.groupRepo.update(groupId, { assigned_driver_id: driverId });

    if (userId) {
      await this.auditLogRepo.save(this.auditLogRepo.create({
        run_id: group.run_id,
        group_id: groupId,
        action_type: GroupingAuditAction.ASSIGN_DRIVER,
        before_payload: before,
        after_payload: { assigned_driver_id: driverId, driver_name: driver.full_name },
        changed_by_user_id: userId,
      }));
    }

    return this.groupRepo.findOneOrFail({ where: { id: groupId } });
  }

  /* ═══════════════════════════════════════════════
     MANUAL ADJUSTMENT
     ═══════════════════════════════════════════════ */

  async manualAdjust(groupId: number, data: any, userId: number): Promise<any> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    switch (data.action) {
      case 'MOVE_EMPLOYEE':
        return this.moveEmployee(group, data.employeeId, data.targetGroupId, userId);
      case 'SPLIT_GROUP':
        return this.splitGroup(group, data.employeeIds, userId);
      case 'MERGE_GROUPS':
        return this.mergeGroups(groupId, data.mergeGroupIds, userId);
      case 'REORDER_STOPS':
        return this.reorderStops(groupId, data.stopOrder, userId);
      case 'OVERRIDE_VEHICLE':
        return this.assignVehicle(groupId, data.vehicleId, userId);
      case 'SET_STATUS':
        await this.groupRepo.update(groupId, { status: data.status, manual_override: true });
        await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.SET_STATUS, { status: group.status }, { status: data.status }, userId);
        return this.groupRepo.findOneOrFail({ where: { id: groupId } });
      case 'SET_CORRIDOR':
        await this.groupRepo.update(groupId, { corridor_id: data.corridorId, corridor_label: data.corridorLabel, manual_override: true });
        await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.SET_CORRIDOR, { corridor_id: group.corridor_id }, { corridor_id: data.corridorId, corridor_label: data.corridorLabel }, userId);
        return this.groupRepo.findOneOrFail({ where: { id: groupId } });
      case 'SET_SPLIT_BOUNDARY':
        return this.setSplitBoundary(group, data.splitBoundaryKm, userId);
      default:
        throw new BadRequestException(`Unknown manual adjustment action: ${data.action}`);
    }
  }

  /* ═══════════════════════════════════════════════
     REORDER STOPS
     ═══════════════════════════════════════════════ */

  async reorderStops(groupId: number, stopOrder: number[], userId: number): Promise<any> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const members = await this.memberRepo.find({ where: { generated_group_id: groupId } });
    const before = members.map(m => ({ employee_id: m.employee_id, stop_sequence: m.stop_sequence }));

    for (let i = 0; i < stopOrder.length; i++) {
      const member = members.find(m => m.employee_id === stopOrder[i]);
      if (member) await this.memberRepo.update(member.id, { stop_sequence: i + 1 });
    }

    await this.groupRepo.update(groupId, { manual_override: true });
    await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.REORDER_STOPS, { stops: before }, { stops: stopOrder }, userId);

    return this.memberRepo.find({ where: { generated_group_id: groupId }, order: { stop_sequence: 'ASC' } });
  }

  /* ═══════════════════════════════════════════════
     LOCK / UNLOCK GROUP
     ═══════════════════════════════════════════════ */

  async lockGroup(groupId: number, userId: number): Promise<GeneratedRouteGroup> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    await this.groupRepo.update(groupId, { locked: true, status: GroupStatus.LOCKED });
    await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.LOCK_GROUP, { locked: false }, { locked: true }, userId);
    return this.groupRepo.findOneOrFail({ where: { id: groupId } });
  }

  async unlockGroup(groupId: number, userId: number): Promise<GeneratedRouteGroup> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    await this.groupRepo.update(groupId, { locked: false, status: GroupStatus.CONFIRMED });
    await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.UNLOCK_GROUP, { locked: true }, { locked: false }, userId);
    return this.groupRepo.findOneOrFail({ where: { id: groupId } });
  }

  /* ═══════════════════════════════════════════════
     AUTO-SPLIT GROUP
     ═══════════════════════════════════════════════ */

  async autoSplitGroup(groupId: number, dto: AutoSplitDto, userId: number): Promise<any> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.locked) throw new BadRequestException('Cannot split a locked group');

    const members = await this.memberRepo.find({
      where: { generated_group_id: groupId },
      order: { distance_from_depot_km: 'ASC' },
    });

    if (members.length < 2) throw new BadRequestException('Group too small to split');

    const vanCap = this.config.get<number>('vehicle.vanCapacity', 15);
    const maxPerSegment = dto.maxPerSegment ?? vanCap;
    const strategy = dto.strategy ?? SplitStrategy.STOP_SEQUENCE_PARTITION;

    const segments: typeof members[] = [];
    for (let i = 0; i < members.length; i += maxPerSegment) {
      segments.push(members.slice(i, Math.min(i + maxPerSegment, members.length)));
    }

    if (segments.length < 2) throw new BadRequestException('Split would result in only one segment');

    const vehicles = await this.vehicleRepo.find({ where: { is_active: true }, order: { capacity: 'ASC' } });
    const newGroups: any[] = [];

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const segLabel = `${group.corridor_label || 'Corridor'}-Seg${s + 1}`;
      const centerLat = seg.reduce((sum, m) => sum + Number(m.lat_snapshot), 0) / seg.length;
      const centerLng = seg.reduce((sum, m) => sum + Number(m.lng_snapshot), 0) / seg.length;

      const rec = this.recommendVehicle(
        seg.length, vehicles,
        this.config.get('vehicle.vanCapacity', 15),
        this.config.get('vehicle.busCapacity', 52),
        this.config.get('vehicle.vanSoftOverflow', 2),
        this.config.get('vehicle.busSoftOverflow', 10),
      );

      const newGroup = await this.groupRepo.save(this.groupRepo.create({
        run_id: group.run_id,
        request_id: group.request_id,
        group_code: `${group.group_code}-S${s + 1}`,
        corridor_id: group.corridor_id,
        corridor_label: group.corridor_label,
        parent_route_segment: segLabel,
        center_lat: centerLat,
        center_lng: centerLng,
        employee_count: seg.length,
        status: GroupStatus.PENDING,
        recommended_vehicle_type: rec.vehicleType,
        recommended_vehicle_id: rec.vehicleId,
        overflow_allowed: rec.overflowNeeded,
        overflow_count: rec.overflowCount,
        capacity_warning: rec.capacityWarning,
        recommendation_reason: rec.reason,
        cluster_note: `${segLabel} — ${seg.length} employees (split from ${group.group_code})`,
        bearing_from_depot: group.bearing_from_depot,
        max_distance_km: Math.max(...seg.map(m => Number(m.distance_from_depot_km) || 0)),
        time_slot: group.time_slot,
      }));

      for (let i = 0; i < seg.length; i++) {
        await this.memberRepo.update(seg[i].id, { generated_group_id: newGroup.id, stop_sequence: i + 1 });
      }

      const boundaryKm = s < segments.length - 1 ? Number(seg[seg.length - 1].distance_from_depot_km) || 0 : undefined;

      await this.splitRepo.save(this.splitRepo.create({
        run_id: group.run_id,
        corridor_id: group.corridor_id,
        parent_group_id: group.id,
        split_strategy: strategy,
        boundary_type: 'DISTANCE_KM',
        boundary_value: boundaryKm ? String(boundaryKm) : undefined,
        segment_code: segLabel,
        segment_order: s + 1,
        reasoning: `Auto-split: ${members.length} employees exceed ${maxPerSegment} per segment capacity`,
      }));

      newGroups.push(newGroup);
    }

    await this.groupRepo.update(groupId, { status: GroupStatus.CANCELLED, cluster_note: `Split into ${segments.length} segments` });

    const run = await this.runRepo.findOne({ where: { id: group.run_id } });
    if (run) {
      const allGroups = await this.groupRepo.count({ where: { run_id: run.id, status: Not(GroupStatus.CANCELLED) } });
      await this.runRepo.update(run.id, { total_groups: allGroups });
    }

    await this.logGroupingAudit(group.run_id, groupId, GroupingAuditAction.AUTO_SPLIT,
      { group_id: groupId, employee_count: group.employee_count },
      { segments: newGroups.map(g => ({ id: g.id, code: g.group_code, count: g.employee_count })) },
      userId);

    return { originalGroup: groupId, segments: newGroups };
  }

  /* ═══════════════════════════════════════════════
     SPLIT BOUNDARY EDIT
     ═══════════════════════════════════════════════ */

  async setSplitBoundary(group: GeneratedRouteGroup, boundaryKm: number, userId: number): Promise<any> {
    const split = await this.splitRepo.findOne({ where: { parent_group_id: group.id } });
    if (split) await this.splitRepo.update(split.id, { boundary_value: String(boundaryKm) });

    await this.logGroupingAudit(group.run_id, group.id, GroupingAuditAction.SET_SPLIT_BOUNDARY,
      { boundary: split?.boundary_value }, { boundary: String(boundaryKm) }, userId);

    return { message: 'Split boundary updated', boundaryKm };
  }

  /* ═══════════════════════════════════════════════
     MERGE SEGMENTS
     ═══════════════════════════════════════════════ */

  async mergeSegments(groupIds: number[], userId: number): Promise<any> {
    if (groupIds.length < 2) throw new BadRequestException('Need at least 2 groups to merge');

    const groups = await this.groupRepo.find({ where: { id: In(groupIds) } });
    if (groups.length !== groupIds.length) throw new NotFoundException('Some groups not found');

    const runIds = new Set(groups.map(g => g.run_id));
    if (runIds.size > 1) throw new BadRequestException('Cannot merge groups from different runs');

    const targetGroup = groups[0];
    const otherGroups = groups.slice(1);
    let totalEmployees = targetGroup.employee_count;

    for (const g of otherGroups) {
      const members = await this.memberRepo.find({ where: { generated_group_id: g.id } });
      for (const m of members) {
        totalEmployees++;
        await this.memberRepo.update(m.id, { generated_group_id: targetGroup.id, stop_sequence: totalEmployees });
      }
      await this.groupRepo.update(g.id, { status: GroupStatus.CANCELLED, cluster_note: `Merged into ${targetGroup.group_code}` });
    }

    await this.groupRepo.update(targetGroup.id, {
      employee_count: totalEmployees,
      cluster_note: `Merged from ${groups.map(g => g.group_code).join(', ')}`,
      manual_override: true,
    });

    // Re-order by distance from depot (farthest first)
    const allMembers = await this.memberRepo.find({
      where: { generated_group_id: targetGroup.id },
      order: { distance_from_depot_km: 'DESC' },
    });
    for (let i = 0; i < allMembers.length; i++) {
      await this.memberRepo.update(allMembers[i].id, { stop_sequence: i + 1 });
    }

    await this.logGroupingAudit(targetGroup.run_id, targetGroup.id, GroupingAuditAction.MERGE_SEGMENTS,
      { groups: groupIds }, { merged_into: targetGroup.id, total_employees: totalEmployees }, userId);

    return this.groupRepo.findOneOrFail({ where: { id: targetGroup.id } });
  }

  /* ═══════════════════════════════════════════════
     GET SEGMENTS FOR GROUP
     ═══════════════════════════════════════════════ */

  async getSegments(groupId: number): Promise<any> {
    return this.splitRepo.find({ where: { parent_group_id: groupId }, order: { segment_order: 'ASC' } });
  }

  /* ═══════════════════════════════════════════════
     EXCEPTIONS
     ═══════════════════════════════════════════════ */

  async getExceptions(runId: number): Promise<AssignmentException[]> {
    return this.exceptionRepo.find({ where: { run_id: runId }, order: { created_at: 'ASC' } });
  }

  async resolveException(exceptionId: number, userId: number, resolution: string, data?: any): Promise<AssignmentException> {
    const exc = await this.exceptionRepo.findOne({ where: { id: exceptionId } });
    if (!exc) throw new NotFoundException('Exception not found');

    const status = resolution === 'WAIVED' ? ExceptionStatus.WAIVED : ExceptionStatus.RESOLVED;
    await this.exceptionRepo.update(exceptionId, {
      status, resolved: true, resolved_by_user_id: userId, resolved_at: new Date(),
    });

    if (data?.lat && data?.lng && exc.employee_id) {
      await this.empRepo.update(exc.employee_id, { lat: data.lat, lng: data.lng, place_id: data.placeId });
    }

    await this.logGroupingAudit(exc.run_id, exc.group_id ?? undefined, GroupingAuditAction.RESOLVE_EXCEPTION,
      { exception_id: exceptionId, status: exc.status }, { status, resolution }, userId);

    return this.exceptionRepo.findOneOrFail({ where: { id: exceptionId } });
  }

  /* ═══════════════════════════════════════════════
     AUDIT LOG
     ═══════════════════════════════════════════════ */

  async getAuditLog(runId: number): Promise<GroupingAuditLog[]> {
    return this.auditLogRepo.find({ where: { run_id: runId }, order: { created_at: 'DESC' } });
  }

  /* ═══════════════════════════════════════════════
     REQUEST GROUPING HISTORY
     ═══════════════════════════════════════════════ */

  async getRequestHistory(requestId: number): Promise<any[]> {
    const runs = await this.runRepo.find({ where: { request_id: requestId }, order: { run_number: 'DESC' } });
    const result = [];
    for (const run of runs) {
      const groups = await this.groupRepo.find({ where: { run_id: run.id }, order: { group_code: 'ASC' } });
      const exceptions = await this.exceptionRepo.find({ where: { run_id: run.id } });
      result.push({ ...run, groups, exceptions, group_count: groups.length, exception_count: exceptions.length });
    }
    return result;
  }

  /* ═══════════════════════════════════════════════
     TRIP MANIFEST GENERATION
     ═══════════════════════════════════════════════ */

  async generateManifest(groupId: number, userId: number): Promise<TripManifest> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (!group.assigned_vehicle_id) throw new BadRequestException('Vehicle must be assigned before generating manifest');

    const members = await this.memberRepo.find({ where: { generated_group_id: groupId }, order: { stop_sequence: 'ASC' } });
    const request = await this.reqRepo.findOne({ where: { id: group.request_id } });

    const employeeList = [];
    const stopSeq = [];
    for (const m of members) {
      const emp = await this.empRepo.findOne({ where: { id: m.employee_id } });
      if (emp) {
        employeeList.push({ employee_id: emp.id, emp_no: emp.emp_no, full_name: emp.full_name, phone: emp.phone });
        stopSeq.push({
          stop_number: m.stop_sequence, employee_id: emp.id, full_name: emp.full_name,
          lat: Number(m.lat_snapshot), lng: Number(m.lng_snapshot), leg_distance_km: Number(m.leg_distance_km) || 0,
        });
      }
    }

    return this.manifestRepo.save(this.manifestRepo.create({
      group_id: groupId,
      vehicle_id: group.assigned_vehicle_id,
      driver_id: group.assigned_driver_id,
      trip_date: request?.request_date || new Date(),
      employee_list: employeeList,
      stop_sequence: stopSeq,
    }));
  }

  /* ═══════════════════════════════════════════════
     PRIVATE HELPERS
     ═══════════════════════════════════════════════ */

  private async resolveDestination(emp: Employee): Promise<{ lat: number; lng: number; placeId?: number; sourceType: SourceType } | null> {
    let lat = emp.lat ? Number(emp.lat) : null;
    let lng = emp.lng ? Number(emp.lng) : null;

    if (lat !== null && lng !== null && this.isValidCoordinate(lat, lng)) {
      return { lat, lng, placeId: emp.place_id ?? undefined, sourceType: SourceType.EMPLOYEE_DIRECT };
    }

    if (emp.place_id) {
      const place = await this.placeRepo.findOne({ where: { id: emp.place_id } });
      if (place) {
        const placeLat = Number(place.latitude);
        const placeLng = Number(place.longitude);
        if (this.isValidCoordinate(placeLat, placeLng)) {
          return { lat: placeLat, lng: placeLng, placeId: emp.place_id, sourceType: SourceType.PLACE_FALLBACK };
        }
      }
    }

    return null;
  }

  private isValidCoordinate(lat: number, lng: number): boolean {
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    return true;
  }

  private matchCorridor(bearing: number, corridors: RouteCorridor[], sectorAngle: number): CorridorMatch {
    for (const c of corridors) {
      if (c.bearing_start != null && c.bearing_end != null) {
        const start = Number(c.bearing_start);
        const end = Number(c.bearing_end);
        if (start <= end) {
          if (bearing >= start && bearing < end) return { corridorId: c.id, corridorLabel: c.name, matchReason: 'Configured corridor match' };
        } else {
          if (bearing >= start || bearing < end) return { corridorId: c.id, corridorLabel: c.name, matchReason: 'Configured corridor match (wrapped)' };
        }
      }
    }

    const sector = Math.floor(bearing / sectorAngle);
    const sectorStart = sector * sectorAngle;
    const sectorEnd = sectorStart + sectorAngle;
    return { corridorLabel: `Sector ${sectorStart}°-${sectorEnd}°`, matchReason: `Dynamic ${sectorAngle}° sector` };
  }

  private generateDropOffOrder(employees: ResolvedEmployee[], order: string): ResolvedEmployee[] {
    const sorted = [...employees].sort((a, b) => a.distanceFromDepot - b.distanceFromDepot);
    return order === 'FARTHEST_FIRST' ? sorted.reverse() : sorted;
  }

  private recommendVehicle(
    count: number, vehicles: Vehicle[],
    vanCap: number, busCap: number, vanOverflow: number, busOverflow: number,
  ): VehicleRecommendation {
    if (count <= vanCap) {
      const van = vehicles.find(v => v.type === VehicleType.VAN && v.capacity >= count);
      if (van) return { vehicleId: van.id, vehicleType: 'VAN', overflowNeeded: false, overflowCount: 0, capacityWarning: false, reason: `Van (${van.registration_no}) fits ${count} employees` };
    }
    if (count <= vanCap + vanOverflow) {
      const van = vehicles.find(v => v.type === VehicleType.VAN);
      if (van) return { vehicleId: van.id, vehicleType: 'VAN', overflowNeeded: true, overflowCount: count - vanCap, capacityWarning: true, reason: `Van with ${count - vanCap} soft overflow` };
    }
    if (count <= busCap) {
      const bus = vehicles.find(v => v.type === VehicleType.BUS && v.capacity >= count);
      if (bus) return { vehicleId: bus.id, vehicleType: 'BUS', overflowNeeded: false, overflowCount: 0, capacityWarning: false, reason: `Bus (${bus.registration_no}) fits ${count} employees` };
    }
    if (count <= busCap + busOverflow) {
      const bus = vehicles.find(v => v.type === VehicleType.BUS);
      if (bus) return { vehicleId: bus.id, vehicleType: 'BUS', overflowNeeded: true, overflowCount: count - busCap, capacityWarning: true, reason: `Bus with ${count - busCap} soft overflow` };
    }
    return { vehicleType: 'BUS', overflowNeeded: false, overflowCount: 0, capacityWarning: true, reason: `No single vehicle for ${count} employees — requires multi-vehicle split` };
  }

  private async moveEmployee(group: GeneratedRouteGroup, employeeId: number, targetGroupId: number, userId: number): Promise<any> {
    const member = await this.memberRepo.findOne({ where: { generated_group_id: group.id, employee_id: employeeId } });
    if (!member) throw new NotFoundException('Employee not found in this group');

    const targetGroup = await this.groupRepo.findOne({ where: { id: targetGroupId } });
    if (!targetGroup) throw new NotFoundException('Target group not found');
    if (targetGroup.locked) throw new BadRequestException('Target group is locked');

    const targetMembers = await this.memberRepo.count({ where: { generated_group_id: targetGroupId } });
    await this.memberRepo.update(member.id, { generated_group_id: targetGroupId, stop_sequence: targetMembers + 1 });

    await this.groupRepo.update(group.id, { employee_count: group.employee_count - 1, manual_override: true });
    await this.groupRepo.update(targetGroupId, { employee_count: targetGroup.employee_count + 1, manual_override: true });

    await this.logGroupingAudit(group.run_id, group.id, GroupingAuditAction.MOVE_EMPLOYEE,
      { employee_id: employeeId, from_group: group.id },
      { employee_id: employeeId, to_group: targetGroupId }, userId);

    return { message: 'Employee moved', fromGroup: group.id, toGroup: targetGroupId };
  }

  private async splitGroup(group: GeneratedRouteGroup, employeeIds: number[], userId: number): Promise<any> {
    if (!employeeIds || employeeIds.length === 0) throw new BadRequestException('Must specify employees for new group');

    const members = await this.memberRepo.find({ where: { generated_group_id: group.id, employee_id: In(employeeIds) } });
    if (members.length === 0) throw new NotFoundException('No matching employees found in group');

    const newGroup = await this.groupRepo.save(this.groupRepo.create({
      run_id: group.run_id,
      request_id: group.request_id,
      group_code: `${group.group_code}-B`,
      corridor_id: group.corridor_id,
      corridor_label: group.corridor_label,
      employee_count: members.length,
      status: GroupStatus.PENDING,
      manual_override: true,
      cluster_note: `Split from ${group.group_code}`,
      bearing_from_depot: group.bearing_from_depot,
      time_slot: group.time_slot,
    }));

    for (let i = 0; i < members.length; i++) {
      await this.memberRepo.update(members[i].id, { generated_group_id: newGroup.id, stop_sequence: i + 1 });
    }

    await this.groupRepo.update(group.id, { employee_count: group.employee_count - members.length, manual_override: true });

    await this.logGroupingAudit(group.run_id, group.id, GroupingAuditAction.SPLIT_GROUP,
      { group_id: group.id, employee_count: group.employee_count },
      { new_group_id: newGroup.id, moved_count: members.length }, userId);

    return { originalGroup: group.id, newGroup };
  }

  private async mergeGroups(groupId: number, mergeGroupIds: number[], userId: number): Promise<any> {
    return this.mergeSegments([groupId, ...mergeGroupIds], userId);
  }

  private async logGroupingAudit(
    runId: number, groupId: number | undefined, action: GroupingAuditAction,
    before: any, after: any, userId: number,
  ): Promise<void> {
    await this.auditLogRepo.save(this.auditLogRepo.create({
      run_id: runId, group_id: groupId, action_type: action,
      before_payload: before, after_payload: after, changed_by_user_id: userId,
    }));
  }

  /* ── Geo utilities ── */

  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
