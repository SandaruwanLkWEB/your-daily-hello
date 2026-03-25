import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useWorkflowApi } from '@/hooks/useWorkflowApi';
import { useDailyLock } from '@/hooks/useDailyLock';
import type { PlaceOption } from '@/components/workflow/LocationEditDialog';
import EmployeeSelectionTable from '@/components/workflow/EmployeeSelectionTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Send, Loader2, Clock, ShieldAlert } from 'lucide-react';
import type { WorkflowEmployee, RequestDetail } from '@/types/workflow';

export default function RequestCreatePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editingRequestId = id ? Number(id) : null;
  const isEditMode = Number.isFinite(editingRequestId);
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    createRequest, updateRequest, addEmployees, submitRequest,
    fetchDeptEmployees, fetchPlaces, updateEmployeeLocation, fetchRequestById, loading,
  } = useWorkflowApi();

  const [requestDate, setRequestDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [otTime, setOtTime] = useState('');
  const [employees, setEmployees] = useState<WorkflowEmployee[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [places, setPlaces] = useState<PlaceOption[]>([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [requestStatus, setRequestStatus] = useState<RequestDetail['status'] | null>(null);

  const { isLocked, loading: lockLoading } = useDailyLock(requestDate);
  const isHod = user?.role === 'HOD';
  const isBlocked = isHod && isLocked;

  useEffect(() => {
    const loadData = async () => {
      setEmpLoading(true);
      setPlacesLoading(true);
      try {
        const [emps, plcs, existing] = await Promise.all([
          fetchDeptEmployees(),
          fetchPlaces(),
          isEditMode && editingRequestId ? fetchRequestById(editingRequestId) : Promise.resolve(null as RequestDetail | null),
        ]);
        setPlaces(plcs);

        const placeMap = new Map(plcs.map(p => [p.id, p]));
        const baseEmployees = emps.map(e => {
          const place = e.place_id ? placeMap.get(e.place_id) : null;
          return {
            ...e,
            location_resolved: !!(e.place_id && (place || (e.lat && e.lng))),
            destination_location: place?.title || e.destination_location || '',
            lat: e.lat ?? place?.latitude,
            lng: e.lng ?? place?.longitude,
          } as WorkflowEmployee;
        });

        if (existing) {
          setRequestDate(existing.request_date);
          setNotes(existing.notes || '');
          setOtTime(existing.ot_time || '');
          setRequestStatus(existing.status);

          const selectedIds = existing.employees?.map(e => e.id) ?? [];
          setSelected(selectedIds);

          const missing = (existing.employees || []).filter(re => !baseEmployees.some(be => be.id === re.id));
          const merged = [...baseEmployees, ...missing].map(e => {
            const place = e.place_id ? placeMap.get(e.place_id) : null;
            return {
              ...e,
              location_resolved: !!((e.place_id && place) || (e.lat && e.lng)),
              destination_location: place?.title || e.destination_location || '',
              lat: e.lat ?? place?.latitude,
              lng: e.lng ?? place?.longitude,
            } as WorkflowEmployee;
          });
          setEmployees(merged);
        } else {
          setEmployees(baseEmployees);
        }
      } finally {
        setEmpLoading(false);
        setPlacesLoading(false);
      }
    };
    loadData();
  }, [editingRequestId, fetchDeptEmployees, fetchPlaces, fetchRequestById, isEditMode]);

  const handleLocationUpdate = async (employeeId: number, place: PlaceOption) => {
    await updateEmployeeLocation(employeeId, place.id, place.latitude, place.longitude);
    setEmployees(prev =>
      prev.map(e =>
        e.id === employeeId
          ? {
              ...e,
              destination_location: place.title,
              lat: place.latitude,
              lng: place.longitude,
              location_resolved: true,
            }
          : e,
      ),
    );
    toast({ title: 'Destination Updated', description: `Drop-off destination set to ${place.title}` });
  };

  const handleSave = async (submit: boolean) => {
    if (isBlocked) {
      toast({
        title: 'Locked',
        description: 'Daily run is locked for this date. You cannot save changes right now.',
        variant: 'destructive',
      });
      return;
    }
    if (selected.length === 0) {
      toast({ title: 'Validation', description: 'Select at least one employee.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (isEditMode && editingRequestId) {
        await updateRequest(editingRequestId, {
          requestDate,
          notes: notes.trim() || undefined,
          otTime: otTime || undefined,
        });
        await addEmployees(editingRequestId, selected);

        if (submit && requestStatus === 'DRAFT') {
          await submitRequest(editingRequestId);
          toast({ title: 'Updated & Submitted', description: 'Drop-off request updated and submitted for approval.' });
        } else {
          toast({ title: 'Updated', description: 'Drop-off request changes saved successfully.' });
        }
        navigate(`/requests/${editingRequestId}`);
        return;
      }

      const req = await createRequest({
        requestDate,
        notes: notes.trim() || undefined,
        otTime: otTime || undefined,
      });

      if (req?.id) {
        await addEmployees(req.id, selected);
        if (submit) {
          await submitRequest(req.id);
          toast({ title: 'Submitted', description: 'Drop-off request created and submitted for approval.' });
        } else {
          toast({ title: 'Saved', description: 'Drop-off request saved as draft.' });
        }
      }
      navigate('/hod/requests');
    } catch {
      toast({ title: 'Error', description: isEditMode ? 'Failed to update request.' : 'Failed to create request.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const canSubmitForApproval = !isEditMode || requestStatus === 'DRAFT';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isEditMode ? 'Edit Drop-Off Request' : 'Create Drop-Off Request'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEditMode
              ? 'Update the request details and employee list before the daily run is locked.'
              : 'Request overtime staff drop-off transport for your department. All vehicles depart from the company depot.'}
          </p>
        </div>
      </div>

      {!lockLoading && isBlocked && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
            <div>
              <p className="font-semibold text-destructive text-sm">Daily Run is Locked for {requestDate}</p>
              <p className="text-xs text-muted-foreground">
                The administrator has locked this date. You cannot create, edit, or submit requests until it is unlocked.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Request Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="dept">Department</Label>
              <Input
                id="dept"
                disabled
                value={user?.departmentId ? `Department ${user.departmentId}` : 'Your Department'}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="date">Drop-Off Date *</Label>
              <Input id="date" type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="otTime" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />Employee OT Time
              </Label>
              <Input id="otTime" type="time" value={otTime} onChange={e => setOtTime(e.target.value)} className="mt-1.5" placeholder="e.g. 18:00" />
              <p className="text-[11px] text-muted-foreground mt-1">Expected overtime finish time for this request</p>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Optional notes for admin review…" value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1.5" />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-xs">How it works</p>
              <p>
                Select employees who need drop-off transport after overtime. Once the administrator locks the day run,
                all approved department requests for that date are combined into one TA grouping run.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Select Employees for Drop-Off</CardTitle></CardHeader>
          <CardContent>
            {empLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
              </div>
            ) : (
              <EmployeeSelectionTable
                employees={employees}
                selected={selected}
                onChange={setSelected}
                places={places}
                placesLoading={placesLoading}
                onLocationUpdate={handleLocationUpdate}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-3 flex-wrap">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving || loading || isBlocked}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          {isEditMode ? 'Save Changes' : 'Save Draft'}
        </Button>
        {canSubmitForApproval && (
          <Button onClick={() => handleSave(true)} disabled={saving || loading || isBlocked}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {isEditMode ? 'Update & Submit' : 'Submit for Approval'}
          </Button>
        )}
      </div>
    </div>
  );
}
