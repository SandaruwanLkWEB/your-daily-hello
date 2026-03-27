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
  Printer, Download, FileText, BarChart3, Info, Loader2, ShieldAlert, AlertCircle,
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
              <li>After HR final approval, print or export PDF</li>
            </ol>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <p className="font-semibold text-foreground text-xs">Data Sources</p>
            <ul className="space-y-0.5">
              <li>• Reports use <span className="font-semibold text-foreground">saved grouping snapshots</span></li>
              <li>• Data is NOT recalculated live</li>
              <li>• Final PDF available only after HR final approval / READY</li>
              <li>• Before that, reports stay blocked</li>
              <li>• Archived reports are read-only</li>
            </ul>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5 text-[11px]">
          <p className="font-semibold text-foreground mb-1">Report Availability by Daily Run Status</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>LOCKED</span><span>→ Awaiting grouping</span>
            <span>GROUPED</span><span>→ Awaiting assignment</span>
            <span>ASSIGNING</span><span>→ Awaiting vehicle assignment</span>
            <span className="font-semibold text-foreground">READY / DISPATCHED</span><span className="font-semibold text-foreground">→ ● Final reports ready</span>
            <span>CLOSED / ARCHIVED</span><span>→ Read-only archive</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

export default function ReportsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'EMP';
  const printRef = useRef<HTMLDivElement>(null);

  const allowedTypes = useMemo(() => ROLE_REPORTS[role] || [], [role]);
  const [selectedType, setSelectedType] = useState<ReportType>(() => allowedTypes[0] || 'route-wise');
  const [filters, setFilters] = useState<ReportFilters>(() => ({ date: getToday() }));
  const [tab, setTab] = useState<'reports' | 'help'>('reports');
  const [reportData, setReportData] = useState<any>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Bug fix #1: React to role changes — auto-correct selectedType if not allowed
  useEffect(() => {
    if (allowedTypes.length > 0 && !allowedTypes.includes(selectedType)) {
      setSelectedType(allowedTypes[0]);
    }
  }, [allowedTypes, selectedType]);

  const hasData = reportData && Array.isArray(reportData) && reportData.length > 0;
  const readiness: ReportReadiness = meta?.readiness ?? 'unavailable';
  const canViewFullReport = !!meta?.canViewFullReport;
  const canExport = canViewFullReport && (readiness === 'ready' || readiness === 'archived');

  const fetchReport = useCallback(async () => {
    if (!allowedTypes.includes(selectedType)) return;
    setLoading(true);
    setFetchError(null);
    try {
      const params: any = {};
      if (filters.date) params.date = filters.date;
      const res = await api.get(`/reports/${selectedType}`, { params });
      const d = res.data?.data ?? res.data;
      setReportData(d?.rows || d?.data || []);
      setMeta(d?.meta || null);
    } catch (err: any) {
      console.error('[ReportsPage] fetch error:', err);
      setReportData([]);
      setMeta(null);
      setFetchError(err?.response?.data?.message || err?.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [selectedType, filters, allowedTypes]);

  useEffect(() => {
    if (allowedTypes.includes(selectedType)) {
      fetchReport();
    }
  }, [fetchReport, selectedType]);

  // Bug fix #3: Print only report content
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleExportPdf = useCallback(() => {
    window.print();
  }, []);

  const handleDownloadSummary = useCallback(() => {
    if (!reportData || !Array.isArray(reportData) || reportData.length === 0) return;
    const keys = Object.keys(reportData[0]);
    const csvRows = [
      keys.join(','),
      ...reportData.map((row: any) =>
        keys.map(k => {
          const val = row[k];
          if (val == null) return '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedType}-report-${filters.date || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportData, selectedType, filters.date]);

  // Bug fix #4: Reset preserves current date (never clears to empty)
  const resetFilters = useCallback(() => {
    setFilters({ date: filters.date || getToday() });
  }, [filters.date]);

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
      <div className="flex items-start justify-between gap-4 flex-wrap no-print">
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
        <TabsList className="no-print">
          <TabsTrigger value="reports" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Reports</TabsTrigger>
          <TabsTrigger value="help" className="gap-1.5"><Info className="h-3.5 w-3.5" /> How It Works</TabsTrigger>
        </TabsList>

        <TabsContent value="help" className="mt-4 no-print">
          <ReportWorkflowHelp />
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="no-print">
            <ReportFiltersBar filters={filters} onChange={setFilters} onReset={resetFilters} />
          </div>

          {/* Type selector — bug fix #2: only show allowed types */}
          <div className="no-print">
            <ReportTypeSelector
              selected={selectedType}
              onChange={t => allowedTypes.includes(t) && setSelectedType(t)}
              allowedTypes={allowedTypes}
            />
          </div>

          {/* Access restriction notice */}
          {allowedTypes.length === 0 && (
            <Card className="no-print">
              <CardContent className="py-8 text-center">
                <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="font-medium text-foreground">Access Restricted</p>
                <p className="text-sm text-muted-foreground mt-1">You do not have permission to view reports.</p>
              </CardContent>
            </Card>
          )}
          {/* Fetch error banner — bug fix #15 */}
          {fetchError && !loading && (
            <div className="no-print flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}
          {!loading && !fetchError && allowedTypes.includes(selectedType) && !canViewFullReport && (
            <div className="no-print flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{meta?.blockedMessage || 'Reports become available only after HR final approval.'}</span>
            </div>
          )}

          {/* Unavailable / empty banner */}
          {!loading && !fetchError && !hasData && readiness === 'unavailable' && (
            <div className="no-print flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              <span>No report data found for the selected date. Make sure a daily run exists and has been grouped for this date.</span>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="no-print flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {/* Export actions */}
          {allowedTypes.length > 0 && (
            <div className="no-print flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={handlePrint} disabled={!hasData || !canExport} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" />
                Print PDF
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={!hasData || !canExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Export PDF
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadSummary} disabled={!hasData || !canExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Download CSV
              </Button>
              {!canExport && (
                <span className="text-[11px] text-muted-foreground ml-2">
                  Reports become available only after HR final approval.
                </span>
              )}
            </div>
          )}

          {/* Report preview panel */}
          {!loading && hasData && canViewFullReport && allowedTypes.includes(selectedType) && (
            <Card className="print:shadow-none print:border-0">
              <CardContent className="p-6 print:p-0" ref={printRef}>
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

          {/* Empty data state (not loading, data fetched but empty, not unavailable) — bug fix #15 */}
          {!loading && !fetchError && canViewFullReport && readiness !== 'unavailable' && !hasData && allowedTypes.includes(selectedType) && (
            <Card className="no-print">
              <CardContent className="py-10 text-center">
                <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="font-medium text-foreground text-sm">No Data Available</p>
                <p className="text-xs text-muted-foreground mt-1">
                  No report data found for this report type on {filters.date || 'the selected date'}.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
