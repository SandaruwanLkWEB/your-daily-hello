import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReportFiltersBar from '@/components/reports/ReportFiltersBar';
import ReportTypeSelector from '@/components/reports/ReportTypeSelector';
import ReportReadinessBadge from '@/components/reports/ReportReadinessBadge';
import RouteWiseReportView from '@/components/reports/RouteWiseReportView';
import VehicleWiseReportView from '@/components/reports/VehicleWiseReportView';
import DepartmentSummaryReportView from '@/components/reports/DepartmentSummaryReportView';
import GroupingReportView from '@/components/reports/GroupingReportView';
import DispatchManifestView from '@/components/reports/DispatchManifestView';
import CostSummaryView from '@/components/reports/CostSummaryView';
import ExceptionReportView from '@/components/reports/ExceptionReportView';
import ArchiveReportsView from '@/components/reports/ArchiveReportsView';
import api from '@/lib/api';
import type { ReportType, ReportFilters, ReportReadiness, ReportMeta } from '@/types/reports';
import type { Role } from '@/types/auth';
import {
  Printer, Download, FileText, BarChart3, Info, Eye, Loader2, ShieldAlert,
} from 'lucide-react';

// ── Role-based access ──
const ROLE_REPORTS: Record<Role, ReportType[]> = {
  SUPER_ADMIN: ['route-wise', 'vehicle-wise', 'department-summary', 'grouping', 'dispatch-manifest', 'cost-summary', 'exception', 'archive'],
  ADMIN: ['route-wise', 'vehicle-wise', 'department-summary', 'grouping', 'dispatch-manifest', 'cost-summary', 'exception', 'archive'],
  HOD: ['route-wise', 'department-summary'],
  HR: ['department-summary', 'dispatch-manifest', 'cost-summary'],
  TRANSPORT_AUTHORITY: ['route-wise', 'vehicle-wise', 'grouping', 'dispatch-manifest', 'exception'],
  PLANNING: ['department-summary', 'cost-summary', 'archive'],
  EMP: [],
};

// Readiness is now provided directly by the backend meta.readiness field,
// which maps DailyRun statuses (LOCKED, GROUPED, ASSIGNING, READY, etc.)
// correctly. Do NOT re-map on the frontend.

function ReportWorkflowHelp() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> How Reports Work</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="font-semibold text-foreground text-xs">Report Workflow</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>HOD submits drop-off request</li>
              <li>Admin approves &amp; daily run is locked</li>
              <li>TA runs automatic grouping</li>
              <li>TA assigns vehicles &amp; drivers</li>
              <li>Run marked as ready for dispatch</li>
              <li>Report data frozen from snapshot</li>
              <li>Users access reports here</li>
              <li>Preview, print, or export PDF</li>
            </ol>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="font-semibold text-foreground text-xs">Data Sources</p>
            <ul className="space-y-0.5">
              <li>• Reports use <span className="font-semibold text-foreground">saved grouping snapshots</span></li>
              <li>• Data is NOT recalculated live</li>
              <li>• Final PDF available after run is READY</li>
              <li>• Preview reports may still change</li>
              <li>• Archived reports are read-only</li>
            </ul>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5 text-[11px]">
          <p className="font-semibold text-foreground mb-1">Report Availability by Daily Run Status</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>LOCKED</span><span>→ Awaiting grouping</span>
            <span>GROUPED</span><span>→ Preview available</span>
            <span>ASSIGNING</span><span>→ Awaiting vehicle assignment</span>
            <span className="font-semibold text-foreground">READY / DISPATCHED</span><span className="font-semibold text-foreground">→ ● Final reports ready</span>
            <span>CLOSED / ARCHIVED</span><span>→ Read-only archive</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
export default function ReportsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'EMP';
  const printRef = useRef<HTMLDivElement>(null);

  const allowedTypes = ROLE_REPORTS[role] || [];
  const [selectedType, setSelectedType] = useState<ReportType>(allowedTypes[0] || 'route-wise');
  const [filters, setFilters] = useState<ReportFilters>({});
  const [tab, setTab] = useState<'reports' | 'help'>('reports');
  const [reportData, setReportData] = useState<any>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [loading, setLoading] = useState(false);

  // Use backend-computed readiness directly — it maps DailyRun statuses correctly.
  // Do NOT re-map via getReadinessForStatus() which uses TransportRequest statuses.
  const readiness: ReportReadiness = meta?.readiness ?? 'unavailable';
  const canExport = readiness === 'ready' || readiness === 'archived';
  const isPreview = readiness === 'preview' || readiness === 'awaiting-hr-approval';

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filters.date) params.date = filters.date;
      const res = await api.get(`/reports/${selectedType}`, { params });
      const d = res.data?.data ?? res.data;
      setReportData(d?.rows || d?.data || []);
      setMeta(d?.meta || null);
    } catch {
      setReportData(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [selectedType, filters]);

  useEffect(() => {
    if (allowedTypes.includes(selectedType)) {
      fetchReport();
    }
  }, [fetchReport, selectedType, allowedTypes]);

  const handlePrint = useCallback(() => { window.print(); }, []);
  const resetFilters = useCallback(() => setFilters({}), []);

  // EMP sees limited view
  if (role === 'EMP') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">My Transport Details</h1>
          <p className="text-sm text-muted-foreground">View your personal drop-off transport assignments.</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-medium text-foreground">Personal transport details</p>
            <p className="text-sm text-muted-foreground mt-1">Your assigned vehicle and drop-off information will appear here when available.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Reports Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operational reports based on approved grouping snapshots
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportReadinessBadge readiness={readiness} />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={v => setTab(v as 'reports' | 'help')}>
        <TabsList>
          <TabsTrigger value="reports" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Reports</TabsTrigger>
          <TabsTrigger value="help" className="gap-1.5"><Info className="h-3.5 w-3.5" /> How It Works</TabsTrigger>
        </TabsList>

        <TabsContent value="help" className="mt-4">
          <ReportWorkflowHelp />
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-4">
          {/* Filters */}
          <ReportFiltersBar filters={filters} onChange={setFilters} onReset={resetFilters} />

          {/* Type selector */}
          <ReportTypeSelector
            selected={selectedType}
            onChange={t => allowedTypes.includes(t) && setSelectedType(t)}
          />

          {/* Access restriction notice */}
          {allowedTypes.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="font-medium text-foreground">Access Restricted</p>
                <p className="text-sm text-muted-foreground mt-1">You do not have permission to view reports.</p>
              </CardContent>
            </Card>
          )}

          {/* Preview mode banner */}
          {isPreview && (
            <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3 text-xs text-[hsl(var(--warning))]">
              <Eye className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">Preview Mode — </span>
                This report is based on current saved assignments and may still change. Final PDF export becomes available after HR approval.
              </span>
            </div>
          )}

          {/* Unavailable banner */}
          {readiness === 'unavailable' && !loading && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              <span>No report data available. Select a request or adjust filters.</span>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {/* Export actions */}
          {allowedTypes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={handlePrint} disabled={!canExport && !isPreview} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" />
                {isPreview ? 'Print Preview' : 'Print PDF'}
              </Button>
              <Button size="sm" variant="outline" disabled={!canExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Export PDF
              </Button>
              <Button size="sm" variant="outline" disabled={!canExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Download Summary
              </Button>
              {!canExport && !isPreview && (
                <span className="text-[11px] text-muted-foreground ml-2">
                  Final PDF export becomes available after HR approval.
                </span>
              )}
            </div>
          )}

          {/* Report preview panel */}
          {!loading && reportData && allowedTypes.includes(selectedType) && readiness !== 'unavailable' && (
            <Card>
              <CardContent className="p-6" ref={printRef}>
                {selectedType === 'route-wise' && <RouteWiseReportView data={reportData} meta={meta!} />}
                {selectedType === 'vehicle-wise' && <VehicleWiseReportView data={reportData} meta={meta!} />}
                {selectedType === 'department-summary' && <DepartmentSummaryReportView data={reportData} meta={meta!} />}
                {selectedType === 'grouping' && <GroupingReportView data={reportData} meta={meta!} />}
                {selectedType === 'dispatch-manifest' && <DispatchManifestView data={reportData} meta={meta!} />}
                {selectedType === 'cost-summary' && <CostSummaryView data={reportData} meta={meta!} />}
                {selectedType === 'exception' && <ExceptionReportView data={reportData} meta={meta!} />}
                {selectedType === 'archive' && <ArchiveReportsView data={reportData} meta={meta!} />}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
