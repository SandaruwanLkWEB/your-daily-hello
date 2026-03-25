import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { MapPin, AlertTriangle, Loader2, Send, Info } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/translateError';

export default function EmpSelfServicePage() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [locName, setLocName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [reason, setReason] = useState('');
  const [locSubmitting, setLocSubmitting] = useState(false);

  const [issueForm, setIssueForm] = useState({ subject: '', description: '' });
  const [issueSubmitting, setIssueSubmitting] = useState(false);

  const submitLocation = async () => {
    const name = locName.trim();
    if (!name) { toast({ title: t('empSelfService.nameRequired'), variant: 'destructive' }); return; }
    if (!lat || !lng) { toast({ title: t('empSelfService.coordsRequired'), variant: 'destructive' }); return; }
    setLocSubmitting(true);
    try {
      await api.post('/self-service/location-change', {
        locationName: name,
        lat: Number(lat),
        lng: Number(lng),
        reason: reason.trim() || undefined,
      });
      toast({ title: t('empSelfService.destChangeSubmitted') });
      setLocName(''); setLat(''); setLng(''); setReason('');
    } catch (err: any) { toast({ title: t('common.error'), description: getApiErrorMessage(err), variant: 'destructive' }); }
    finally { setLocSubmitting(false); }
  };

  const submitIssue = async () => {
    if (!issueForm.subject.trim()) { toast({ title: t('empSelfService.subjectRequired'), variant: 'destructive' }); return; }
    setIssueSubmitting(true);
    try {
      await api.post('/self-service/issues', { subject: issueForm.subject.trim(), description: issueForm.description.trim() || undefined });
      toast({ title: t('empSelfService.issueSubmitted') });
      setIssueForm({ subject: '', description: '' });
    } catch (err: any) { toast({ title: t('common.error'), description: getApiErrorMessage(err), variant: 'destructive' }); }
    finally { setIssueSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">{t('empSelfService.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('empSelfService.subtitle')}</p>
      </div>
      <Tabs defaultValue="location" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="location" className="gap-1.5"><MapPin className="h-3.5 w-3.5" /> {t('empSelfService.destinationChange')}</TabsTrigger>
          <TabsTrigger value="issue" className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {t('empSelfService.reportIssue')}</TabsTrigger>
        </TabsList>

        <TabsContent value="location">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-primary" /> {t('empSelfService.requestDestChange')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Instruction note */}
              <Alert className="border-primary/30 bg-primary/5">
                <Info className="h-4 w-4 text-primary" />
                <AlertDescription className="text-xs text-foreground/80">
                  {t('empSelfService.locationNameNote')}
                </AlertDescription>
              </Alert>

              <p className="text-xs text-muted-foreground">{t('empSelfService.destChangeDesc')}</p>

              {/* Location name */}
              <div>
                <Label>{t('empSelfService.locationName')} *</Label>
                <Input
                  value={locName}
                  onChange={e => setLocName(e.target.value)}
                  placeholder={t('empSelfService.locationNamePlaceholder')}
                  maxLength={255}
                />
              </div>

              {/* Lat / Lng */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('empSelfService.latitude')} *</Label>
                  <Input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="e.g. 6.9271" />
                </div>
                <div>
                  <Label>{t('empSelfService.longitude')} *</Label>
                  <Input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="e.g. 79.8612" />
                </div>
              </div>

              <div>
                <Label>{t('empSelfService.reason')}</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={t('empSelfService.reasonPlaceholder')} rows={3} maxLength={500} />
              </div>
              <Button onClick={submitLocation} disabled={locSubmitting || !locName.trim() || !lat || !lng} className="gap-1.5">
                {locSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('empSelfService.submitRequest')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issue">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-primary" /> {t('empSelfService.submitIssue')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>{t('empSelfService.subject')} *</Label><Input value={issueForm.subject} onChange={e => setIssueForm(f => ({ ...f, subject: e.target.value }))} placeholder={t('empSelfService.subjectPlaceholder')} maxLength={255} /></div>
              <div><Label>{t('common.description')}</Label><Textarea value={issueForm.description} onChange={e => setIssueForm(f => ({ ...f, description: e.target.value }))} placeholder={t('empSelfService.descriptionPlaceholder')} rows={4} maxLength={1000} /></div>
              <Button onClick={submitIssue} disabled={issueSubmitting} className="gap-1.5">
                {issueSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('empSelfService.submitIssue')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
