import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  TransportRequest,
  TransportRequestEmployee,
  RequestStatusHistory,
  ApprovalHistory,
} from './transport-request.entity';
import { PaginatedResult } from '../../common/dto';
import { RequestStatus } from '../../common/enums';
import { Department } from '../departments/department.entity';
import { Employee } from '../employees/employee.entity';
import { User } from '../users/user.entity';
import { DailyLock } from '../daily-lock/daily-lock.entity';

/* ─── Internal types ─── */

interface CreatePayload {
  departmentId: number;
  requestDate: string;
  notes?: string;
  otTime?: string;
}

interface ListQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  departmentId?: number;
  status?: RequestStatus;
}

/* ─── Service ─── */

@Injectable()
export class TransportRequestsService {
  private readonly logger = new Logger(TransportRequestsService.name);

  constructor(
    @InjectRepository(TransportRequest) private readonly reqRepo: Repository<TransportRequest>,
    @InjectRepository(TransportRequestEmployee) private readonly reqEmpRepo: Repository<TransportRequestEmployee>,
    @InjectRepository(RequestStatusHistory) private readonly historyRepo: Repository<RequestStatusHistory>,
    @InjectRepository(ApprovalHistory) private readonly approvalRepo: Repository<ApprovalHistory>,
    @InjectRepository(Department) private readonly deptRepo: Repository<Department>,
    @InjectRepository(Employee) private readonly empRepo: Repository<Employee>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(DailyLock) private readonly dailyLockRepo: Repository<DailyLock>,
  ) {}

  /* ────────────────── List ────────────────── */

  async findAll(query: ListQuery): Promise<PaginatedResult<TransportRequest>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'request_date',
      sortOrder = 'DESC',
      departmentId,
      status,
    } = query;

    const where: any = {};
    if (departmentId) where.department_id = departmentId;
    if (status) where.status = status;

    const [items, total] = await this.reqRepo.findAndCount({
      where,
      relations: ['department'],
      order: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /* ────────────────── Single request with full details ────────────────── */

  async findById(id: number): Promise<any> {
    const req = await this.reqRepo.findOne({
      where: { id },
      relations: ['department', 'createdByUser'],
    });
    if (!req) throw new NotFoundException(`Transport request #${id} not found`);

    // Load employees
    const reqEmps = await this.reqEmpRepo.find({
      where: { request_id: id },
      order: { created_at: 'ASC' },
    });
    const employeeIds = reqEmps.map(re => re.employee_id);
    let employees: any[] = [];
    if (employeeIds.length > 0) {
      const emps = await this.empRepo.findByIds(employeeIds);
      employees = emps.map(e => ({
        id: e.id,
        emp_no: e.emp_no || '',
        full_name: e.full_name,
        department: e.department_id?.toString(),
        phone: e.phone,
        destination_location: e.place_id ? `Place #${e.place_id}` : undefined,
        lat: e.lat ? Number(e.lat) : undefined,
        lng: e.lng ? Number(e.lng) : undefined,
        location_resolved: !!(e.lat && e.lng),
        place_id: e.place_id,
      }));
    }

    // Load status history
    const statusHistory = await this.historyRepo.find({
      where: { request_id: id },
      order: { created_at: 'ASC' },
    });

    // Resolve user names
    const userIds = new Set<number>();
    if (req.created_by_user_id) userIds.add(req.created_by_user_id);
    statusHistory.forEach(h => { if (h.changed_by_user_id) userIds.add(h.changed_by_user_id); });

    const users = userIds.size > 0
      ? await this.userRepo.findByIds(Array.from(userIds))
      : [];
    const userMap = new Map(users.map(u => [u.id, u.full_name]));

    return {
      ...req,
      department_name: req.department?.name || `Department ${req.department_id}`,
      created_by_name: userMap.get(req.created_by_user_id) || 'Unknown',
      employee_count: employees.length,
      employees,
      status_history: statusHistory.map(h => ({
        id: h.id,
        from_status: h.from_status,
        to_status: h.to_status,
        changed_by: userMap.get(h.changed_by_user_id!) || 'System',
        reason: h.reason,
        created_at: h.created_at,
      })),
    };
  }

  /* ────────────────── Create ────────────────── */

  async create(data: CreatePayload, userId: number): Promise<TransportRequest> {
    // Validate department exists
    const dept = await this.deptRepo.findOne({ where: { id: data.departmentId } });
    if (!dept) {
      throw new BadRequestException(`Department #${data.departmentId} not found`);
    }

    await this.ensureDateUnlocked(data.requestDate);

    const request = this.reqRepo.create({
      department_id: data.departmentId,
      request_date: data.requestDate as any,
      notes: data.notes?.trim() || undefined,
      ot_time: data.otTime || undefined,
      created_by_user_id: userId,
      status: RequestStatus.DRAFT,
    });

    const saved = await this.reqRepo.save(request);
    this.logger.log(`Request #${saved.id} created by user #${userId} for dept #${data.departmentId}`);
    return saved;
  }

  /* ────────────────── Update (draft only) ────────────────── */

  async update(id: number, data: { notes?: string; requestDate?: string; otTime?: string }): Promise<TransportRequest> {
    const req = await this.findOneOrFail(id);
    if (![RequestStatus.DRAFT, RequestStatus.SUBMITTED].includes(req.status)) {
      throw new BadRequestException('Only draft or submitted requests can be edited before daily lock');
    }

    await this.ensureDateUnlocked(data.requestDate || this.toDateString(req.request_date));

    const updateFields: any = {};
    if (data.notes !== undefined) updateFields.notes = data.notes.trim() || null;
    if (data.requestDate) updateFields.request_date = data.requestDate;
    if (data.otTime !== undefined) updateFields.ot_time = data.otTime || null;

    await this.reqRepo.update(id, updateFields);
    return this.findOneOrFail(id);
  }

  /* ────────────────── Add employees ────────────────── */

  async addEmployees(requestId: number, employeeIds: number[]): Promise<{ message: string; count: number }> {
    const req = await this.findOneOrFail(requestId);
    if (![RequestStatus.DRAFT, RequestStatus.SUBMITTED].includes(req.status)) {
      throw new BadRequestException('Cannot modify employees after daily lock or approval workflow has progressed');
    }
    await this.ensureDateUnlocked(this.toDateString(req.request_date));

    // Remove existing then add fresh (idempotent)
    await this.reqEmpRepo.delete({ request_id: requestId });

    const entries = employeeIds.map(eid =>
      this.reqEmpRepo.create({ request_id: requestId, employee_id: eid }),
    );
    await this.reqEmpRepo.save(entries);

    this.logger.log(`Request #${requestId}: ${entries.length} employees assigned`);
    return { message: 'Employees saved', count: entries.length };
  }

  /* ────────────────── Remove employees ────────────────── */

  async removeEmployees(requestId: number, employeeIds: number[]): Promise<{ message: string }> {
    const req = await this.findOneOrFail(requestId);
    if (![RequestStatus.DRAFT, RequestStatus.SUBMITTED].includes(req.status)) {
      throw new BadRequestException('Cannot modify employees at this stage');
    }
    await this.ensureDateUnlocked(this.toDateString(req.request_date));

    for (const eid of employeeIds) {
      await this.reqEmpRepo.delete({ request_id: requestId, employee_id: eid });
    }
    return { message: `${employeeIds.length} employee(s) removed` };
  }

  /* ────────────────── Status transitions ────────────────── */

  async submit(id: number, userId: number): Promise<TransportRequest> {
    const req = await this.findOneOrFail(id);
    await this.ensureDateUnlocked(this.toDateString(req.request_date));

    // Verify at least one employee is assigned
    const empCount = await this.reqEmpRepo.count({ where: { request_id: id } });
    if (empCount === 0) {
      throw new BadRequestException('Cannot submit a request with no employees');
    }
    return this.transition(id, RequestStatus.DRAFT, RequestStatus.SUBMITTED, userId);
  }

  async adminApprove(id: number, userId: number): Promise<TransportRequest> {
    const req = await this.transition(id, RequestStatus.SUBMITTED, RequestStatus.ADMIN_APPROVED, userId);
    await this.reqRepo.update(id, { admin_approved_by: userId, admin_approved_at: new Date() });
    await this.logApproval(id, 'ADMIN_APPROVE', userId);
    return req;
  }

  async adminReject(id: number, userId: number, reason?: string): Promise<TransportRequest> {
    const req = await this.transition(id, RequestStatus.SUBMITTED, RequestStatus.ADMIN_REJECTED, userId, reason);
    await this.reqRepo.update(id, { rejection_reason: reason || undefined });
    await this.logApproval(id, 'ADMIN_REJECT', userId, reason);
    return req;
  }

  async lockDailyRun(id: number, userId: number): Promise<any> {
    const anchor = await this.findOneOrFail(id);
    if (anchor.status !== RequestStatus.ADMIN_APPROVED) {
      throw new BadRequestException('Only admin-approved requests can be used to lock a daily run');
    }

    const lockDate = this.toDateString(anchor.request_date);
    const alreadyLocked = await this.dailyLockRepo.findOne({ where: { lock_date: lockDate as any, is_locked: true } });
    if (alreadyLocked) {
      throw new BadRequestException(`Daily run for ${lockDate} is already locked`);
    }

    const sameDayApproved = await this.reqRepo.find({
      where: { request_date: lockDate as any, status: RequestStatus.ADMIN_APPROVED },
      order: { department_id: 'ASC', id: 'ASC' },
    });

    if (sameDayApproved.length === 0) {
      throw new BadRequestException(`No admin-approved requests found for ${lockDate}`);
    }

    await this.dailyLockRepo.save(this.dailyLockRepo.create({
      lock_date: lockDate as any,
      is_locked: true,
      locked_by_user_id: userId,
      locked_at: new Date(),
    }));

    for (const req of sameDayApproved) {
      await this.historyRepo.save(this.historyRepo.create({
        request_id: req.id,
        from_status: req.status,
        to_status: RequestStatus.DAILY_LOCKED,
        changed_by_user_id: userId,
        reason: `Daily run locked for ${lockDate}`,
      }));
      await this.reqRepo.update(req.id, {
        status: RequestStatus.DAILY_LOCKED,
        daily_locked_by: userId,
        daily_locked_at: new Date(),
      });
    }

    this.logger.log(`Daily run locked for ${lockDate} by user #${userId} across ${sameDayApproved.length} request(s)`);
    return {
      message: `Daily run locked for ${lockDate}`,
      date: lockDate,
      lockedCount: sameDayApproved.length,
      requestIds: sameDayApproved.map(r => r.id),
    };
  }

  async markTaProcessing(id: number, userId: number): Promise<TransportRequest> {
    return this.transition(id, RequestStatus.DAILY_LOCKED, RequestStatus.TA_PROCESSING, userId);
  }

  async markGroupingCompleted(id: number, userId: number): Promise<TransportRequest> {
    return this.transition(id, RequestStatus.TA_PROCESSING, RequestStatus.GROUPING_COMPLETED, userId);
  }

  async markTaCompleted(id: number, userId: number): Promise<TransportRequest> {
    const anchor = await this.findOneOrFail(id);
    if (![RequestStatus.GROUPING_COMPLETED, RequestStatus.TA_PROCESSING, RequestStatus.GROUPED].includes(anchor.status)) {
      throw new BadRequestException(`Cannot complete TA from status ${anchor.status}`);
    }

    const requestDate = this.toDateString(anchor.request_date);
    const sameDay = await this.reqRepo.find({
      where: { request_date: requestDate as any, status: In([RequestStatus.GROUPING_COMPLETED, RequestStatus.TA_PROCESSING, RequestStatus.GROUPED]) },
    });

    for (const req of sameDay) {
      await this.historyRepo.save(this.historyRepo.create({
        request_id: req.id,
        from_status: req.status,
        to_status: RequestStatus.TA_COMPLETED,
        changed_by_user_id: userId,
        reason: `TA completed combined daily run for ${requestDate}`,
      }));
      await this.reqRepo.update(req.id, { status: RequestStatus.TA_COMPLETED });
    }

    return this.findOneOrFail(id);
  }

  async hrApprove(id: number, userId: number): Promise<TransportRequest> {
    const anchor = await this.findOneOrFail(id);
    const requestDate = this.toDateString(anchor.request_date);
    const sameDay = await this.reqRepo.find({
      where: { request_date: requestDate as any, status: RequestStatus.TA_COMPLETED },
    });
    if (!sameDay.length) throw new BadRequestException('No TA-completed requests found for this daily run');

    for (const req of sameDay) {
      await this.historyRepo.save(this.historyRepo.create({
        request_id: req.id,
        from_status: req.status,
        to_status: RequestStatus.HR_APPROVED,
        changed_by_user_id: userId,
        reason: `HR approved combined daily run for ${requestDate}`,
      }));
      await this.reqRepo.update(req.id, { status: RequestStatus.HR_APPROVED, hr_approved_by: userId, hr_approved_at: new Date() });
      await this.logApproval(req.id, 'HR_APPROVE', userId);
    }

    return this.findOneOrFail(id);
  }

  async hrReject(id: number, userId: number, reason?: string): Promise<TransportRequest> {
    const anchor = await this.findOneOrFail(id);
    const requestDate = this.toDateString(anchor.request_date);
    const sameDay = await this.reqRepo.find({
      where: { request_date: requestDate as any, status: RequestStatus.TA_COMPLETED },
    });
    if (!sameDay.length) throw new BadRequestException('No TA-completed requests found for this daily run');

    for (const req of sameDay) {
      await this.historyRepo.save(this.historyRepo.create({
        request_id: req.id,
        from_status: req.status,
        to_status: RequestStatus.HR_REJECTED,
        changed_by_user_id: userId,
        reason: reason || `HR rejected combined daily run for ${requestDate}`,
      }));
      await this.reqRepo.update(req.id, { status: RequestStatus.HR_REJECTED, rejection_reason: reason || undefined });
      await this.logApproval(req.id, 'HR_REJECT', userId, reason);
    }

    return this.findOneOrFail(id);
  }

  async dispatch(id: number, userId: number): Promise<TransportRequest> {
    return this.transition(id, RequestStatus.HR_APPROVED, RequestStatus.DISPATCHED, userId);
  }

  async close(id: number, userId: number): Promise<TransportRequest> {
    return this.transition(id, RequestStatus.DISPATCHED, RequestStatus.CLOSED, userId);
  }

  async cancel(id: number, userId: number, reason?: string): Promise<TransportRequest> {
    const req = await this.findOneOrFail(id);
    if ([RequestStatus.DISPATCHED, RequestStatus.CLOSED, RequestStatus.ARCHIVED, RequestStatus.CANCELLED].includes(req.status)) {
      throw new BadRequestException(`Cannot cancel a ${req.status} request`);
    }
    return this.transition(id, req.status, RequestStatus.CANCELLED, userId, reason);
  }


  private async ensureDateUnlocked(date: string): Promise<void> {
    const lock = await this.dailyLockRepo.findOne({ where: { lock_date: date as any, is_locked: true } });
    if (lock) {
      throw new BadRequestException(`Daily run for ${date} is locked. You cannot create or edit requests for this date.`);
    }
  }

  private toDateString(value: string | Date): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
  }

  /* ────────────────── Private helpers ────────────────── */

  private async findOneOrFail(id: number): Promise<TransportRequest> {
    const req = await this.reqRepo.findOne({ where: { id } });
    if (!req) throw new NotFoundException(`Transport request #${id} not found`);
    return req;
  }

  private async transition(
    id: number,
    expectedFrom: RequestStatus,
    to: RequestStatus,
    userId: number,
    reason?: string,
  ): Promise<TransportRequest> {
    const req = await this.findOneOrFail(id);

    if (req.status !== expectedFrom) {
      throw new BadRequestException(
        `Cannot transition from "${req.status}" to "${to}". Expected current status to be "${expectedFrom}".`,
      );
    }

    // Record history
    await this.historyRepo.save(
      this.historyRepo.create({
        request_id: id,
        from_status: req.status,
        to_status: to,
        changed_by_user_id: userId,
        reason,
      }),
    );

    await this.reqRepo.update(id, { status: to });
    this.logger.log(`Request #${id}: ${req.status} → ${to} by user #${userId}`);

    return this.findOneOrFail(id);
  }

  private async logApproval(requestId: number, action: string, userId: number, reason?: string): Promise<void> {
    await this.approvalRepo.save(
      this.approvalRepo.create({
        request_id: requestId,
        action,
        performed_by_user_id: userId,
        reason,
      }),
    );
  }
}
