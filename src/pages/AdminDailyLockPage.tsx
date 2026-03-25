import { useState, useEffect, useCallback } from 'react';
import { useDailyLock } from '@/hooks/useDailyLock';
import { useWorkflowApi } from '@/hooks/useWorkflowApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  Lock, Unlock, Calendar, Users, FileText, CheckCircle, AlertTriangle,
  Loader2, Shield, Info,
} from 'lucide-react';

export default function AdminDailyLockPage() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });

  const {
    isLocked, status, loading, actionLoading,
    lock, unlock, refresh,
    approvedRequestCount, lockedRequestCount, totalEmployeeCount,
  } = useDailyLock(selectedDate);

  const wfApi = useWorkflowApi();
  const [recentLocks, setRecentLocks] = useState<any[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const loadRecentLocks = useCallback(async () => {
    setRecentLoading(true);
    try {
      const dates = await wfApi.fetchLockedDates();
      setRecentLocks(dates);
    } catch { /* handled by hook */ }
    finally { setRecentLoading(false); }
  }, [wfApi.fetchLockedDates]);

  useEffect(() => {
    loadRecentLocks();
  }, [loadRecentLocks]);

  const handleLock = async () => {
    try {
      const result = await lock();
      toast({
        title: 'Daily Run Locked',
        description: `${result?.lockedRequestCount || 0} requests locked with ${result?.totalEmployeeCount || 0} employees for ${selectedDate}`,
      });
      loadRecentLocks();
    } catch { /* handled by hook */ }
  };

  const handleUnlock = async () => {
    try {
      await unlock();
      toast({ title: 'Daily Run Unlocked', description: `Requests for ${selectedDate} are now editable again.` });
      loadRecentLocks();
    } catch { /* handled by hook */ }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Lock Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lock all admin-approved drop-off requests for a date to create a combined daily batch for TA processing
        </p>
      </div>

      {/* Info banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How Daily Lock Works</p>
            <p>1. HODs submit drop-off requests for a date → 2. Admin approves requests → 3. Admin locks the date here → 4. TA processes the combined batch</p>
            <p className="text-xs">Locking combines ALL approved requests across departments into one daily batch. HODs cannot edit requests after lock.</p>
          </div>
        </CardContent>
      </Card>

      {/* Date selector & status */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />Select Date
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="lockDate">Drop-Off Date</Label>
              <Input
                id="lockDate"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Status indicator */}
                <div className={`rounded-lg p-4 border ${isLocked ? 'bg-primary/5 border-primary/20' : 'bg-muted/50 border-border'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {isLocked ? (
                      <Lock className="h-5 w-5 text-primary" />
                    ) : (
                      <Unlock className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="font-semibold text-foreground">
                      {isLocked ? 'Locked' : 'Not Locked'}
                    </span>
                    <Badge variant={isLocked ? 'default' : 'secondary'}>
                      {selectedDate}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground">
                        {isLocked ? lockedRequestCount : approvedRequestCount}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {isLocked ? 'Locked Requests' : 'Approved Requests'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground">{totalEmployeeCount}</p>
                      <p className="text-[10px] text-muted-foreground">Employees</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground">
                        {isLocked ? '✓' : '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {isLocked ? 'Ready for TA' : 'Pending Lock'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {!isLocked && approvedRequestCount === 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">
                      No approved requests for {selectedDate}. Approve HOD requests first before locking.
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  {!isLocked ? (
                    <Button
                      onClick={handleLock}
                      disabled={actionLoading || approvedRequestCount === 0}
                      className="flex-1"
                    >
                      {actionLoading ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Lock className="mr-1.5 h-4 w-4" />
                      )}
                      Lock Daily Run ({approvedRequestCount} requests)
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={handleUnlock}
                      disabled={actionLoading}
                      className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/5"
                    >
                      {actionLoading ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Unlock className="mr-1.5 h-4 w-4" />
                      )}
                      Unlock Daily Run
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent locked dates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />Recent Locked Dates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : recentLocks.length === 0 ? (
              <div className="py-8 text-center">
                <Calendar className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No locked dates yet</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentLocks.map((lock: any) => {
                  const dateStr = typeof lock.lock_date === 'string' ? lock.lock_date.split('T')[0] : lock.lock_date;
                  return (
                    <div
                      key={lock.id}
                      className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/30 ${
                        dateStr === selectedDate ? 'border-primary/30 bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedDate(dateStr)}
                    >
                      <div className="flex items-center gap-2.5">
                        <Lock className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{dateStr}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Locked {new Date(lock.locked_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          <FileText className="h-2.5 w-2.5 mr-1" />{lock.locked_request_count}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          <Users className="h-2.5 w-2.5 mr-1" />{lock.total_employee_count}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
