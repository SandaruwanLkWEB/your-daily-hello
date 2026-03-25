import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflowApi } from '@/hooks/useWorkflowApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Cog, Users, Truck, HelpCircle, RefreshCw, Lock } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { RequestDetail } from '@/types/workflow';

type DailyRunCard = RequestDetail & {
  request_count: number;
  combined_departments: string[];
  combined_request_ids: number[];
};

function summarizeDailyRuns(items: RequestDetail[]): DailyRunCard[] {
  const grouped = new Map<string, RequestDetail[]>();
  for (const item of items) {
    const key = item.request_date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, requests]) => {
      const departments = Array.from(new Set(requests.map(r => r.department_name || `Department ${r.department_id}`)));
      const priorityStatuses = ['TA_PROCESSING', 'GROUPED', 'GROUPING_COMPLETED', 'TA_COMPLETED', 'DAILY_LOCKED'];
      const status = priorityStatuses.find(s => requests.some(r => r.status === s)) || requests[0].status;
      const representative = requests[0];
      return {
        ...representative,
        status: status as any,
        request_date: date,
        department_name: departments.length > 1 ? `${departments.length} departments combined` : departments[0],
        notes: `Daily run with ${requests.length} request(s): ${departments.join(', ')}`,
        employee_count: requests.reduce((sum, r) => sum + (r.employee_count ?? 0), 0),
        request_count: requests.length,
        combined_departments: departments,
        combined_request_ids: requests.map(r => r.id),
      };
    });
}

export default function TaProcessingPage() {
  const navigate = useNavigate();
  const wfApi = useWorkflowApi();
  const [requests, setRequests] = useState<RequestDetail[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [runningId, setRunningId] = useState<number | null>(null);

  useEffect(() => {
    setPageLoading(true);
    wfApi.fetchRequests().then(r => {
      setRequests(
        r.filter(x => ['DAILY_LOCKED', 'TA_PROCESSING', 'GROUPED', 'GROUPING_COMPLETED', 'TA_COMPLETED'].includes(x.status)),
      );
      setPageLoading(false);
    });
  }, [wfApi.fetchRequests]);

  const queue = useMemo(
    () => summarizeDailyRuns(requests.filter(r => r.status === 'DAILY_LOCKED')),
    [requests],
  );
  const processing = useMemo(
    () => summarizeDailyRuns(requests.filter(r => ['TA_PROCESSING', 'GROUPED', 'GROUPING_COMPLETED'].includes(r.status))),
    [requests],
  );

  const handleRunGrouping = async (dailyRun: DailyRunCard) => {
    setRunningId(dailyRun.id);
    try {
      await wfApi.runGrouping(dailyRun.id);
      navigate(`/ta/assignments/${dailyRun.id}`);
    } finally {
      setRunningId(null);
    }
  };

  const totalEmployees = requests.reduce((a, r) => a + (r.employee_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Drop-Off Daily Runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Transport Authority can group only after Admin locks the day. Once locked, all approved department requests for that date are combined into one run.
        </p>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <HelpCircle className="h-3.5 w-3.5" /> How daily grouping works
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground text-sm">Daily combined grouping flow</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>HODs create and submit department requests.</li>
                <li>Admin approves department requests.</li>
                <li>Admin locks the daily run for a date.</li>
                <li>All approved requests for that date are combined into a single TA grouping run.</li>
                <li>TA groups the entire day together, not department-by-department.</li>
                <li>Vehicle assignment and HR review happen against the combined daily run.</li>
              </ol>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4 flex items-center gap-3"><Lock className="h-8 w-8 text-primary" /><div><p className="text-2xl font-bold text-foreground">{queue.length}</p><p className="text-xs text-muted-foreground">Locked Daily Runs</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-8 w-8 text-[hsl(var(--warning))]" /><div><p className="text-2xl font-bold text-foreground">{processing.length}</p><p className="text-xs text-muted-foreground">Runs In Progress</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Truck className="h-8 w-8 text-[hsl(var(--success))]" /><div><p className="text-2xl font-bold text-foreground">{totalEmployees}</p><p className="text-xs text-muted-foreground">Employees in TA scope</p></div></CardContent></Card>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Locked Runs ({queue.length})</TabsTrigger>
          <TabsTrigger value="processing">In Progress ({processing.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-3">
          {pageLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : queue.length === 0 ? (
            <Card><CardContent className="py-12 text-center"><Cog className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" /><p className="font-medium text-foreground">No locked daily runs pending</p><p className="text-sm text-muted-foreground">Admin must lock the day before TA grouping can start.</p></CardContent></Card>
          ) : queue.map(run => (
            <Card key={`${run.request_date}-${run.id}`}>
              <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">RUN-{run.request_date}</span>
                    <Badge variant="outline">{run.request_count} request(s)</Badge>
                    <Badge variant="secondary">{run.combined_departments.length} department(s)</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{run.request_date}</span>
                    <span>{run.employee_count ?? 0} employees</span>
                    <span>{run.department_name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{run.notes}</p>
                </div>
                <Button onClick={() => handleRunGrouping(run)} disabled={runningId === run.id} className="shrink-0">
                  {runningId === run.id ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <Cog className="mr-1.5 h-4 w-4" />}
                  Run Daily Grouping
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="processing" className="mt-4 space-y-3">
          {processing.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No daily runs in progress</CardContent></Card>
          ) : processing.map(run => (
            <Card key={`${run.request_date}-${run.id}`} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/ta/assignments/${run.id}`)}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">RUN-{run.request_date}</span>
                      <Badge variant="outline">{run.request_count} request(s)</Badge>
                      <Badge variant="secondary">{run.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{run.employee_count ?? 0} employees</span>
                      <span>{run.department_name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{run.notes}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
